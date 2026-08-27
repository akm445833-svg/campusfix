# CampusFix — Android App (WebView wrapper via Capacitor)

This turns your **already-live** CampusFix website into an installable Android app.
Do this *after* the website is deployed (see main `campusFix/README.md`).

## One-time setup (needs your own machine — Node.js + Android Studio installed)

1. **Point it at your live site.** Open `capacitor.config.json` and replace:
   ```
   "url": "https://REPLACE-WITH-YOUR-LIVE-URL.onrender.com"
   ```
   with your actual Render (or wherever) URL.

2. **Install dependencies**
   ```bash
   cd campusfix-android
   npm install
   npm install -g @capacitor/cli
   ```

3. **Add the Android platform**
   ```bash
   npx cap add android
   npx cap sync android
   ```
   This generates a full native Android project inside `android/`.

4. **Open in Android Studio**
   ```bash
   npx cap open android
   ```
   Android Studio will open the generated project.

5. **Build the APK**
   In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
   The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk` — copy it to your phone and install (enable "install from unknown sources" if prompted), or share it with others.

6. **App icon / name** — edit `android/app/src/main/res/` icons and `strings.xml` (`app_name`) if you want a custom icon/name instead of the Capacitor default.

## Publishing to Play Store (optional, later)
- You'll need a signed **release** build (not debug) and a $25 one-time Google Play Developer account.
- Android Studio: **Build → Generate Signed Bundle/APK** → follow the keystore wizard → upload the resulting `.aab` to the Play Console.

## Why this approach
Since CampusFix is a website (not written in React Native/Flutter), the fastest real path to "an app" is wrapping the live site in a native WebView shell — Capacitor does exactly this. The app just displays your live website full-screen with no browser address bar; any change you make to the live site's HTML/CSS/JS automatically shows up in the app too (no app-store update needed) because it's loading the live URL, not bundled files.
