import 'account_store.dart';
import 'account_store_io.dart'
    if (dart.library.js_interop) 'account_store_web.dart' as impl;

/// Returns the persistent store for the current platform:
/// a JSON file on native, `localStorage` on web.
AccountStore createAccountStore() => impl.createPlatformAccountStore();
