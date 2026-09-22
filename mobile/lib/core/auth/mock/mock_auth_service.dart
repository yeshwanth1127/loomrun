import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';

import '../app_user.dart';
import '../auth_service.dart';
import 'account_store.dart';
import 'account_store_factory.dart';

/// Frontend-only authentication backed by a local [AccountStore].
///
/// - Registered accounts are persisted (survive quit/restart).
/// - The session is never persisted — every launch starts signed out.
/// - Passwords are hashed before they are stored.
class MockAuthService extends ChangeNotifier implements AuthService {
  MockAuthService({AccountStore? store})
      : _store = store ?? createAccountStore();

  final AccountStore _store;
  final Map<String, StoredAccount> _accounts = {};
  AppUser? _currentUser;
  bool _initialized = false;

  @override
  bool get isInitialized => _initialized;

  @override
  AppUser? get currentUser => _currentUser;

  @override
  bool get isAuthenticated => _currentUser != null;

  @override
  Future<void> init() async {
    _accounts
      ..clear()
      ..addEntries(
        (await _store.readAll()).map((a) => MapEntry(a.email, a)),
      );
    _currentUser = null; // sessions are never restored
    _initialized = true;
    notifyListeners();
  }

  @override
  Future<String?> signIn({
    required String fullName,
    required String email,
    required String password,
    required String confirmPassword,
  }) async {
    final name = fullName.trim();
    final mail = _normalizeEmail(email);

    if (name.isEmpty) return 'Enter your full name.';
    if (!_isValidEmail(mail)) return 'Enter a valid Email ID.';
    if (password.length < 6) {
      return 'Password must be at least 6 characters.';
    }
    if (password != confirmPassword) return 'Passwords do not match.';
    if (_accounts.containsKey(mail)) {
      return 'This Email ID is already registered. Please log in.';
    }

    final account = StoredAccount(
      fullName: name,
      email: mail,
      passwordHash: _hash(password),
    );
    _accounts[mail] = account;
    await _store.writeAll(_accounts.values.toList());

    _currentUser = AppUser(fullName: name, email: mail);
    notifyListeners();
    return null;
  }

  @override
  Future<String?> logIn({
    required String email,
    required String password,
  }) async {
    final mail = _normalizeEmail(email);

    if (!_isValidEmail(mail)) return 'Enter a valid Email ID.';
    if (password.isEmpty) return 'Enter your password.';

    final account = _accounts[mail];
    if (account == null) return 'No account found. Please sign in.';
    if (account.passwordHash != _hash(password)) {
      return 'Incorrect password.';
    }

    _currentUser = AppUser(fullName: account.fullName, email: account.email);
    notifyListeners();
    return null;
  }

  @override
  Future<void> logOut() async {
    _currentUser = null;
    notifyListeners();
  }

  /// DEV ONLY (see `lib/core/config/dev_config.dart`). Starts a session for
  /// [user] without registering or persisting anything.
  void startDevSession(AppUser user) {
    _currentUser = user;
    notifyListeners();
  }

  @override
  bool hasAccount(String email) =>
      _accounts.containsKey(_normalizeEmail(email));

  @visibleForTesting
  Future<void> debugReset() async {
    _accounts.clear();
    _currentUser = null;
    _initialized = false;
    await _store.writeAll(const []);
  }

  static String _normalizeEmail(String email) => email.trim().toLowerCase();

  static bool _isValidEmail(String email) =>
      RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email);

  static String _hash(String password) =>
      sha256.convert(utf8.encode('loom_run::$password')).toString();
}
