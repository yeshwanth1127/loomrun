import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../api/token_store.dart';
import 'app_user.dart';
import 'auth_service.dart';

/// JWT auth against the existing Loomrun FastAPI backend (`/v1/auth/*`).
class ApiAuthService extends ChangeNotifier implements AuthService {
  ApiAuthService({
    ApiClient? client,
    TokenStore? tokens,
  })  : _client = client ?? apiClient,
        _tokens = tokens ?? tokenStore {
    _client.onSessionExpired = () async {
      await logOut();
    };
  }

  final ApiClient _client;
  final TokenStore _tokens;

  AppUser? _currentUser;
  List<OrgMembership> _organizations = const [];
  String? _activeOrgId;
  bool _initialized = false;

  @override
  bool get isInitialized => _initialized;

  @override
  AppUser? get currentUser => _currentUser;

  @override
  bool get isAuthenticated => _currentUser != null;

  @override
  String? get activeOrgId => _activeOrgId;

  @override
  String? get activeOrgName {
    final id = _activeOrgId;
    if (id == null) return null;
    for (final m in _organizations) {
      if (m.orgId == id) return m.orgName;
    }
    return null;
  }

  @override
  List<OrgMembership> get organizations => List.unmodifiable(_organizations);

  @override
  Future<void> init() async {
    final access = await _tokens.getAccessToken();
    if (access == null || access.isEmpty) {
      _currentUser = null;
      _organizations = const [];
      _activeOrgId = null;
      _initialized = true;
      notifyListeners();
      return;
    }

    try {
      await _loadMeAndSelectOrg();
    } catch (_) {
      final ok = await _client.refreshAccessToken();
      if (ok) {
        try {
          await _loadMeAndSelectOrg();
        } catch (_) {
          await _clearSession();
        }
      } else {
        await _clearSession();
      }
    }

    _initialized = true;
    notifyListeners();
  }

  @override
  Future<String?> signIn({
    required String fullName,
    required String email,
    required String password,
    required String confirmPassword,
    String? organizationName,
  }) async {
    final name = fullName.trim();
    final mail = email.trim().toLowerCase();
    final orgName = (organizationName ?? '').trim().isEmpty
        ? "$name's Organization"
        : organizationName!.trim();

    if (name.isEmpty) return 'Enter your full name.';
    if (!_isValidEmail(mail)) return 'Enter a valid Email ID.';
    if (password.length < 8) {
      return 'Password must be at least 8 characters.';
    }
    if (password != confirmPassword) return 'Passwords do not match.';
    if (orgName.isEmpty) return 'Enter an organization name.';

    try {
      final data = await _client.post<Map<String, dynamic>>(
        '/v1/auth/register',
        json: {
          'email': mail,
          'password': password,
          'name': name,
          'organization_name': orgName,
        },
      );
      await _tokens.setTokens(
        access: data['access_token'] as String,
        refresh: data['refresh_token'] as String,
      );
      await _loadMeAndSelectOrg();
      notifyListeners();
      return null;
    } on ApiException catch (e) {
      return e.message;
    } catch (e) {
      return e.toString();
    }
  }

  @override
  Future<String?> logIn({
    required String email,
    required String password,
  }) async {
    final mail = email.trim().toLowerCase();
    if (!_isValidEmail(mail)) return 'Enter a valid Email ID.';
    if (password.isEmpty) return 'Enter your password.';

    try {
      final data = await _client.post<Map<String, dynamic>>(
        '/v1/auth/login',
        json: {'email': mail, 'password': password},
      );
      await _tokens.setTokens(
        access: data['access_token'] as String,
        refresh: data['refresh_token'] as String,
      );
      await _loadMeAndSelectOrg();
      notifyListeners();
      return null;
    } on ApiException catch (e) {
      if (e.statusCode == 401) return 'Invalid credentials.';
      return e.message;
    } catch (e) {
      return e.toString();
    }
  }

  @override
  Future<void> logOut() async {
    await _clearSession();
    notifyListeners();
  }

  @override
  Future<void> setActiveOrg(String orgId) async {
    if (!_organizations.any((o) => o.orgId == orgId)) return;
    _activeOrgId = orgId;
    await _tokens.setActiveOrgId(orgId);
    notifyListeners();
  }

  @override
  bool hasAccount(String email) => false;

  Future<void> _loadMeAndSelectOrg() async {
    final me = await _client.get<Map<String, dynamic>>('/v1/auth/me');
    final name = (me['name'] as String?)?.trim();
    final email = me['email'] as String? ?? '';
    _currentUser = AppUser(
      id: me['id'] as String?,
      fullName: (name == null || name.isEmpty) ? '' : name,
      email: email,
    );

    final rawOrgs = me['organizations'] as List<dynamic>? ?? const [];
    _organizations = rawOrgs
        .whereType<Map<String, dynamic>>()
        .map(OrgMembership.fromJson)
        .where((o) => o.orgId.isNotEmpty)
        .toList();

    final saved = await _tokens.getActiveOrgId();
    if (saved != null && _organizations.any((o) => o.orgId == saved)) {
      _activeOrgId = saved;
    } else if (_organizations.isNotEmpty) {
      _activeOrgId = _organizations.first.orgId;
      await _tokens.setActiveOrgId(_activeOrgId);
    } else {
      _activeOrgId = null;
      await _tokens.setActiveOrgId(null);
    }
  }

  Future<void> _clearSession() async {
    await _tokens.clearTokens();
    await _tokens.setActiveOrgId(null);
    _currentUser = null;
    _organizations = const [];
    _activeOrgId = null;
  }

  static bool _isValidEmail(String email) =>
      RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email);
}
