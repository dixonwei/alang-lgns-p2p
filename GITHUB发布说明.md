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
## 启用 GitHub Pages

1. 打开 https://github.com/dixonwei/alang-lgns-p2p/settings/pages
2. Source 选择 `Deploy from a branch`。
3. Branch 选择 `main`，目录选择 `/ (root)`。
4. 点击 Save。
5. 等待约 1 分钟，访问 https://dixonwei.github.io/alang-lgns-p2p/ 。

公开展示版会把订单保存在当前浏览器，不会同步给其他学员。正式的跨用户撮合需要部署 Node.js 后端服务。
