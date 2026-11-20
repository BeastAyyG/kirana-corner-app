import 'package:shared_preferences/shared_preferences.dart';

/// Runtime configuration. The backend base URL is configurable so the app can
/// point at the Android-emulator host loopback (10.0.2.2), a LAN IP for a real
/// device, or a deployed server. Persisted across launches.
class AppConfig {
  static const String defaultBaseUrl = 'http://10.0.2.2:3000';
  static const String _key = 'kc-base-url';

  static String baseUrl = defaultBaseUrl;

  static Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    baseUrl = prefs.getString(_key) ?? defaultBaseUrl;
  }

  static Future<void> setBaseUrl(String value) async {
    var v = value.trim();
    if (v.isEmpty) v = defaultBaseUrl;
    v = v.replaceAll(RegExp(r'/+$'), '');
    if (!v.startsWith('http://') && !v.startsWith('https://')) v = 'http://$v';
    baseUrl = v;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, v);
  }

  /// Resolve a server-relative asset path (e.g. /img/products/tomato.webp) to an
  /// absolute URL. Already-absolute URLs (seller https art) pass through.
  static String resolveUrl(String? path) {
    if (path == null || path.isEmpty) return '';
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
      return path;
    }
    return '$baseUrl${path.startsWith('/') ? '' : '/'}$path';
  }

  static String get apiBase => '$baseUrl/api/v2';
}