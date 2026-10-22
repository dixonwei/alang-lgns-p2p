// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        (bool ok, bytes memory data) = address(token).call(abi.encodeCall(IERC20.transfer, (to, value)));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FAILED");
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        (bool ok, bytes memory data) = address(token).call(abi.encodeCall(IERC20.transferFrom, (from, to, value)));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FROM_FAILED");
    }
}

/// @title LGNSHTLC
/// @notice Non-custodial hash-time-locked swap primitive for fee-on-transfer ERC20 tokens.
/// @dev This contract has not been audited. Do not use with real funds before review.
contract LGNSHTLC {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 300;
    uint256 public constant MAX_BPS = 10_000;
    uint256 public constant MIN_TIMELOCK = 10 minutes;
    uint256 public constant MAX_TIMELOCK = 24 hours;

    address public immutable feeRecipient;
    uint256 private _reentrancyLock = 1;

    struct Swap {
        address sender;
        address beneficiary;
        address token;
        uint256 amount;
        bytes32 hashlock;
        uint256 timelock;
        bool feeOnClaim;
        bool settled;
        bool refunded;
    }

    mapping(bytes32 => Swap) private swaps;

    event Locked(
        bytes32 indexed swapId,
        address indexed sender,
        address indexed beneficiary,
        address token,
        uint256 requestedAmount,
        uint256 receivedAmount,
        bytes32 hashlock,
        uint256 timelock,
        bool feeOnClaim
    );
    event Claimed(
        bytes32 indexed swapId,
        address indexed beneficiary,
        uint256 beneficiaryAmount,
        uint256 feeAmount,
        bytes32 secret
    );
    event Refunded(bytes32 indexed swapId, address indexed sender, uint256 amount);

    modifier nonReentrant() {
        require(_reentrancyLock == 1, "REENTRANT");
        _reentrancyLock = 2;
        _;
        _reentrancyLock = 1;
    }

    constructor(address _feeRecipient) {
        require(_feeRecipient != address(0), "BAD_FEE_RECIPIENT");
        feeRecipient = _feeRecipient;
    }

    /// @notice Lock tokens with a hashlock. The actual amount received is recorded to support transfer-tax tokens.
    /// @param swapId Unique order identifier generated off-chain.
    /// @param token The ERC20 token being locked.
    /// @param amount Requested amount to transfer from the sender.
    /// @param beneficiary The wallet allowed to claim.
    /// @param hashlock keccak256(abi.encodePacked(secret)).
    /// @param timelock Unix timestamp after which the sender can refund.
    /// @param feeOnClaim True when this side represents the seller's proceeds and should pay the fixed 3% fee.
    function lock(
        bytes32 swapId,
        address token,
        uint256 amount,
        address beneficiary,
        bytes32 hashlock,
        uint256 timelock,
        bool feeOnClaim
    ) external nonReentrant {
        require(swapId != bytes32(0), "BAD_SWAP_ID");
        require(swaps[swapId].sender == address(0), "SWAP_EXISTS");
        require(token != address(0) && token.code.length > 0, "BAD_TOKEN");
        require(amount > 0, "BAD_AMOUNT");
        require(beneficiary != address(0), "BAD_BENEFICIARY");
        require(hashlock != bytes32(0), "BAD_HASHLOCK");
        require(timelock >= block.timestamp + MIN_TIMELOCK, "TIMELOCK_TOO_SHORT");
        require(timelock <= block.timestamp + MAX_TIMELOCK, "TIMELOCK_TOO_LONG");

        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - beforeBalance;
        require(received > 0, "ZERO_RECEIVED");

        swaps[swapId] = Swap({
            sender: msg.sender,
            beneficiary: beneficiary,
            token: token,
            amount: received,
            hashlock: hashlock,
            timelock: timelock,
            feeOnClaim: feeOnClaim,
            settled: false,
            refunded: false
        });

        emit Locked(swapId, msg.sender, beneficiary, token, amount, received, hashlock, timelock, feeOnClaim);
    }

    /// @notice Claim before the timelock by revealing the preimage. Anyone holding the secret may submit it.
    function claim(bytes32 swapId, bytes32 secret) external nonReentrant {
        Swap storage item = swaps[swapId];
        require(item.sender != address(0), "SWAP_NOT_FOUND");
        require(!item.settled && !item.refunded, "SWAP_CLOSED");
        require(block.timestamp < item.timelock, "SWAP_EXPIRED");
        require(keccak256(abi.encodePacked(secret)) == item.hashlock, "BAD_SECRET");

        item.settled = true;
        uint256 beneficiaryAmount = item.amount;
        uint256 feeAmount = 0;

        if (item.feeOnClaim) {
            feeAmount = (item.amount * FEE_BPS) / MAX_BPS;
            beneficiaryAmount = item.amount - feeAmount;
        }

        if (feeAmount > 0) {
            IERC20(item.token).safeTransfer(feeRecipient, feeAmount);
        }
        IERC20(item.token).safeTransfer(item.beneficiary, beneficiaryAmount);

        emit Claimed(swapId, item.beneficiary, beneficiaryAmount, feeAmount, secret);
    }

    /// @notice Refund after the timelock. Only the original sender can trigger the refund.
    function refund(bytes32 swapId) external nonReentrant {
        Swap storage item = swaps[swapId];
        require(item.sender != address(0), "SWAP_NOT_FOUND");
        require(!item.settled && !item.refunded, "SWAP_CLOSED");
        require(block.timestamp >= item.timelock, "NOT_EXPIRED");
        require(msg.sender == item.sender, "NOT_SENDER");

        item.refunded = true;
        IERC20(item.token).safeTransfer(item.sender, item.amount);

        emit Refunded(swapId, item.sender, item.amount);
    }

    function getSwap(bytes32 swapId) external view returns (Swap memory) {
        return swaps[swapId];
    }

    function hashSecret(bytes32 secret) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(secret));
    }
}