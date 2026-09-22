import 'package:flutter/foundation.dart';

import 'app_user.dart';

/// The authentication contract the app depends on.
///
/// The UI, router, and Home screen talk only to this interface. The current
/// implementation is [MockAuthService] (local, frontend-only); replacing it
/// with real auth (Firebase, a REST backend, …) should not require changes
/// outside `lib/core/auth/`.
abstract class AuthService implements Listenable {
  /// Whether [init] has completed. Show a splash until this is true.
  bool get isInitialized;

  /// The signed-in user for this run, or `null` when signed out.
  AppUser? get currentUser;

  bool get isAuthenticated;

  /// Loads any persisted state. Never restores a session — the app always
  /// starts signed out.
  Future<void> init();

  /// Registers a new account, persists it, and starts a session.
  /// Returns an error message, or `null` on success.
  Future<String?> signIn({
    required String fullName,
    required String email,
    required String password,
    required String confirmPassword,
  });

  /// Authenticates an existing account and starts a session.
  /// Returns an error message, or `null` on success.
  Future<String?> logIn({
    required String email,
    required String password,
  });

  /// Ends the session. Registered accounts are kept.
  Future<void> logOut();

  /// Whether an account with this email is already registered locally.
  bool hasAccount(String email);
}
