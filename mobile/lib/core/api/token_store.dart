import 'package:shared_preferences/shared_preferences.dart';

/// Persists JWT tokens and the active org id (mirrors web localStorage keys).
class TokenStore {
  static const _accessKey = 'access_token';
  static const _refreshKey = 'refresh_token';
  static const _orgKey = 'loomrun_active_org';

  Future<String?> getAccessToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_accessKey);
  }

  Future<String?> getRefreshToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_refreshKey);
  }

  Future<void> setTokens({
    required String access,
    required String refresh,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_accessKey, access);
    await prefs.setString(_refreshKey, refresh);
  }

  Future<void> clearTokens() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_accessKey);
    await prefs.remove(_refreshKey);
  }

  Future<String?> getActiveOrgId() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_orgKey);
  }

  Future<void> setActiveOrgId(String? orgId) async {
    final prefs = await SharedPreferences.getInstance();
    if (orgId == null || orgId.isEmpty) {
      await prefs.remove(_orgKey);
    } else {
      await prefs.setString(_orgKey, orgId);
    }
  }
}

final tokenStore = TokenStore();
