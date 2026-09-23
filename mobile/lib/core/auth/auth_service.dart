import 'package:flutter/foundation.dart';

import 'app_user.dart';

/// The authentication contract the app depends on.
///
/// The UI, router, and Home screen talk only to this interface.
abstract class AuthService implements Listenable {
  /// Whether [init] has completed. Show a splash until this is true.
  bool get isInitialized;

  /// The signed-in user for this run, or `null` when signed out.
  AppUser? get currentUser;

  bool get isAuthenticated;

  /// Active organization id for CRM API calls (`/v1/orgs/{orgId}/…`).
  String? get activeOrgId;

  /// Display name of the active organization, if known.
  String? get activeOrgName;

  /// Memberships returned by `/v1/auth/me`.
  List<OrgMembership> get organizations;

  /// Loads any persisted session (tokens) and restores the user when possible.
  Future<void> init();

  /// Registers a new account (and org on the backend), then starts a session.
  /// Returns an error message, or `null` on success.
  Future<String?> signIn({
    required String fullName,
    required String email,
    required String password,
    required String confirmPassword,
    String? organizationName,
  });

  /// Authenticates an existing account and starts a session.
  /// Returns an error message, or `null` on success.
  Future<String?> logIn({
    required String email,
    required String password,
  });

  /// Ends the session. Registered accounts are kept on the backend.
  Future<void> logOut();

  /// Switch the active organization (persisted locally).
  Future<void> setActiveOrg(String orgId);

  /// Whether an account with this email is already known locally.
  /// Real API auth always returns `false` (the server is the source of truth).
  bool hasAccount(String email);
}
