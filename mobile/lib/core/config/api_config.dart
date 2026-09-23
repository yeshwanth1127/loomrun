/// Backend API base URL — same FastAPI server the web app uses.
///
/// Override at build/run time:
/// ```
/// flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8000
/// ```
///
/// Defaults:
/// - Android emulator → `10.0.2.2` (host loopback)
/// - Everything else → `localhost`
library;

import 'package:flutter/foundation.dart';

const String _kApiBaseUrlDefine = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: '',
);

String get apiBaseUrl {
  if (_kApiBaseUrlDefine.isNotEmpty) return _kApiBaseUrlDefine;
  // Android emulator cannot reach the host via localhost.
  if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
    return 'http://10.0.2.2:8000';
  }
  return 'http://localhost:8000';
}
