import 'package:flutter/foundation.dart';

import 'api_auth_service.dart';
import 'auth_service.dart';
import 'mock/mock_auth_service.dart';

export 'app_user.dart';
export 'auth_service.dart';

/// App-wide auth handle. Production uses the FastAPI JWT backend; tests and
/// offline UI work can swap in [MockAuthService] via [debugSetAuthService].
AuthService authController = ApiAuthService();

@visibleForTesting
void debugSetAuthService(AuthService service) => authController = service;
