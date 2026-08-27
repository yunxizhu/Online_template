# 联机大厅 · 安卓加入端

可安装的 Android APK。界面与电脑大厅类似（公开房间、人员、所有人聊天、房间码加入），**不能创建房间**；建房请用电脑。

## 安装 APK

1. 把 APK 拷到手机本地（不要微信/网盘里直接装）：
   - 一键打包：`dist/android/lianji.apk`（正式签名，包名 `com.lianji.join`）
   - 或：`mobile/dist/lianji-android.apk`
2. 允许「未知来源 / 安装未知应用」
3. 用文件管理打开安装 → 桌面出现「联机大厅」

若华为机一直「正在安装」：划掉安装页 → 设置里强停「软件包安装程序」并清缓存 → 卸载旧的「联机大厅」/`com.lianji.client` → 再装本包。

## 用法

1. **电脑**先启动联机大厅并创建房间
2. 手机打开 App → 输入昵称 → **进入大厅**
3. 在公开房间列表点「加入」，或用「房间码加入」
4. 大厅内可使用「所有人」聊天（与电脑 MQTT 同源）

系统返回键可从房主页面退回本 App 大厅。

## 重新编译

```bat
cd mobile
npm install
npx cap sync android
cd android
gradlew.bat assembleRelease
```
