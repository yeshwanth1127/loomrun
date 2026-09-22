import 'package:flutter/foundation.dart';

import 'auth_service.dart';
import 'mock/mock_auth_service.dart';

export 'app_user.dart';
export 'auth_service.dart';

/// App-wide auth handle. Today it is the local mock; swap the assignment for a
/// real [AuthService] implementation and nothing else needs to change.
AuthService authController = MockAuthService();

@visibleForTesting
void debugSetAuthService(AuthService service) => authController = service;
