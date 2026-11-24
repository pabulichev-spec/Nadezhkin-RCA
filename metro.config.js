const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, {
  input: "./global.css",
  // Keep the filesystem mode for native/development compatibility. During
  // production web export, Expo bundles the web and SSR entry points in
  // parallel; forcing a shared css-interop cache file creates a Metro race.
  forceWriteFileSystem: process.env.PUMPRCA_WEB_EXPORT !== "1",
});
