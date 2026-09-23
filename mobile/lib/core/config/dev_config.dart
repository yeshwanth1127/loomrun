import '../auth/auth.dart';
import '../auth/mock/mock_auth_service.dart';

/// ---------------------------------------------------------------------------
/// DEVELOPMENT ONLY
///
/// When [kBypassAuth] is `true` **and** the auth controller is still the local
/// [MockAuthService], the app skips the Sign in / Log in screen on startup.
///
/// Real API auth (`ApiAuthService`) ignores this flag — use a real login, or
/// swap to the mock via `debugSetAuthService` in tests.
///
/// Enable with: `--dart-define=BYPASS_AUTH=true`
/// ---------------------------------------------------------------------------
const bool kBypassAuth =
    bool.fromEnvironment('BYPASS_AUTH', defaultValue: false);

/// The stand-in user shown on Home while [kBypassAuth] is on.
const AppUser kDevUser = AppUser(
  fullName: 'Dev User',
  email: 'dev@loomrun.local',
);

/// Call once, right after [AuthService.init], before `runApp`.
/// No-op unless [kBypassAuth] is enabled and auth is the mock.
Future<void> applyDevAuthBypass() async {
  if (!kBypassAuth) return;
  final service = authController;
  if (service is MockAuthService && !service.isAuthenticated) {
    service.startDevSession(kDevUser);
  }
}
