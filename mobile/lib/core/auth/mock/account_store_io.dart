import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'account_store.dart';

AccountStore createPlatformAccountStore() => FileAccountStore();

/// Persists accounts to a JSON file in the OS application-support directory
/// (e.g. `%APPDATA%\loom_run` on Windows, `~/Library/Application Support` on
/// macOS, the app sandbox on Android/iOS).
///
/// This is real on-device storage: it survives a full quit/restart and has
/// nothing to do with dev-server ports.
class FileAccountStore implements AccountStore {
  static const _fileName = 'loom_run_accounts.json';

  Future<File> _file() async {
    final dir = await getApplicationSupportDirectory();
    return File('${dir.path}${Platform.pathSeparator}$_fileName');
  }

  @override
  Future<List<StoredAccount>> readAll() async {
    try {
      final file = await _file();
      if (!await file.exists()) return [];
      final raw = await file.readAsString();
      if (raw.trim().isEmpty) return [];
      return (jsonDecode(raw) as List)
          .cast<Map<String, dynamic>>()
          .map(StoredAccount.fromJson)
          .toList();
    } catch (_) {
      // Corrupt or unreadable file — treat as "no accounts" rather than crash.
      return [];
    }
  }

  @override
  Future<void> writeAll(List<StoredAccount> accounts) async {
    final file = await _file();
    await file.create(recursive: true);
    await file.writeAsString(
      jsonEncode(accounts.map((a) => a.toJson()).toList()),
      flush: true,
    );
  }
}
