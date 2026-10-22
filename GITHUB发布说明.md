# GitHub 发布说明

## 可以发布的内容

当前目录已经整理为 Git 仓库，可公开源码。

- 不包含 `data/`，因此不会上传管理员密码和本地订单；
- `vendor/ethers.umd.min.js` 为签名校验依赖；
- `网站预览.png` 可用于 README 展示。

## GitHub Pages 的限制

GitHub Pages 只能托管静态 HTML/CSS/JS，不能运行本项目的 Node.js 服务端，所以以下功能在 GitHub Pages 上不可用：

- 管理员登录；
- 服务端钱包签名校验；
- 订单保存；
- 管理员取消订单；
- API 接口。

完整功能需要部署到支持 Node.js 的平台或 VPS。

## Git 推送

如果创建公开仓库 `alang-lgns-p2p`，可以使用：

```bash
git remote add origin https://github.com/你的用户名/alang-lgns-p2p.git
git push -u origin main
```

不要把 `data/admin-password.txt` 上传到公开仓库。