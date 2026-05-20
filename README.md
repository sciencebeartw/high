# 山熊升大學生端

這個 repository 直接部署 GitHub Pages 的高中部家長/學生端：

- 正式網址：`https://www.sciencebear.com.tw/high/`
- 本機來源：`/Users/huangboyu/Desktop/code/bear-admin/high`
- 後端資料：Firebase Realtime Database `sciencebear-admin` 專案的 `/high`
- GAS 同步/API：`/Users/huangboyu/Desktop/code/GAS/高中`

`/high/` 不再是跳轉頁或 iframe 殼，也不再以 GAS Web App 畫面作為家長端入口，而是直接載入新版 `山熊升大` App。

`GAS/高中` 保留作為 Google Sheet -> Firebase `/high` 的同步來源，以及少數後端動作 API；不要再把 GAS 專案內容同步到這個 repo。
