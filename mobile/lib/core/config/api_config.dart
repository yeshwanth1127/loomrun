/// Backend API base URL — same FastAPI server the web app uses.
///
/// Override at build/run time:
/// ```
/// flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8000
/// ```
///
/// Defaults:
/// - Release builds → `https://loomrun.exora.solutions`
/// - Android emulator (debug) → `10.0.2.2` (host loopback)
/// - Everything else in debug → `localhost`
library;

import 'package:flutter/foundation.dart';

const String _kApiBaseUrlDefine = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: '',
);

const String _kProductionApiBaseUrl = 'https://loomrun.exora.solutions';

String get apiBaseUrl {
  if (_kApiBaseUrlDefine.isNotEmpty) return _kApiBaseUrlDefine;
  if (kReleaseMode) return _kProductionApiBaseUrl;
  // Android emulator cannot reach the host via localhost.
  if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
    return 'http://10.0.2.2:8000';
  }
  return 'http://localhost:8000';
}
