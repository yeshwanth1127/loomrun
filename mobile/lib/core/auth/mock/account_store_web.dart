import 'dart:convert';

import 'package:web/web.dart' as web;

import 'account_store.dart';

AccountStore createPlatformAccountStore() => LocalStorageAccountStore();

/// Persists accounts to `window.localStorage`.
///
/// Browser storage is scoped to the page origin (scheme + host + port), which
/// is a browser rule, not something this app controls. For a stable dev
/// experience on the web, serve the app from a stable origin
/// (`flutter run -d chrome --web-port=<fixed>` or a real build). Native
/// targets have no such constraint.
class LocalStorageAccountStore implements AccountStore {
  static const _key = 'loom_run.accounts';

  @override
  Future<List<StoredAccount>> readAll() async {
    final raw = web.window.localStorage.getItem(_key);
    if (raw == null || raw.trim().isEmpty) return [];
    try {
      return (jsonDecode(raw) as List)
          .cast<Map<String, dynamic>>()
          .map(StoredAccount.fromJson)
          .toList();
    } catch (_) {
      return [];
    }
  }

  @override
  Future<void> writeAll(List<StoredAccount> accounts) async {
    web.window.localStorage.setItem(
      _key,
      jsonEncode(accounts.map((a) => a.toJson()).toList()),
    );
  }
}
