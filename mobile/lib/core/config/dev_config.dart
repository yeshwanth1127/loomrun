import '../auth/auth.dart';
import '../auth/mock/mock_auth_service.dart';

/// ---------------------------------------------------------------------------
/// DEVELOPMENT ONLY
///
/// When [kBypassAuth] is `true`, the app skips the Sign in / Log in screen on
/// startup and opens straight to Home using a throwaway local session.
///
/// To restore the normal auth flow: set [kBypassAuth] to `false` (or build with
/// `--dart-define=BYPASS_AUTH=false`).
///
/// This does NOT touch any auth code — the screens, validation and local
/// persistence are all still wired up. It only pre-fills a session so the
/// gate in `main.dart` lets you through.
/// ---------------------------------------------------------------------------
const bool kBypassAuth =
    bool.fromEnvironment('BYPASS_AUTH', defaultValue: true);

/// The stand-in user shown on Home while [kBypassAuth] is on.
const AppUser kDevUser = AppUser(
  fullName: 'Dev User',
  email: 'dev@loomrun.local',
);

/// Call once, right after [AuthService.init], before `runApp`.
/// No-op unless [kBypassAuth] is enabled.
Future<void> applyDevAuthBypass() async {
  if (!kBypassAuth) return;
  final service = authController;
  if (service is MockAuthService && !service.isAuthenticated) {
    service.startDevSession(kDevUser);
  }
}
