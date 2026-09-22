/// Persistence boundary for the mock auth implementation.
///
/// This is the only place that touches a storage backend. Swapping in real
/// authentication means deleting this whole `mock/` folder — nothing outside
/// it depends on these types.
abstract class AccountStore {
  Future<List<StoredAccount>> readAll();

  Future<void> writeAll(List<StoredAccount> accounts);
}

/// A registered account as it sits on disk. Passwords are stored hashed —
/// never in clear text — even for the mock.
class StoredAccount {
  final String fullName;
  final String email;
  final String passwordHash;

  const StoredAccount({
    required this.fullName,
    required this.email,
    required this.passwordHash,
  });

  factory StoredAccount.fromJson(Map<String, dynamic> json) => StoredAccount(
        fullName: json['fullName'] as String,
        email: json['email'] as String,
        passwordHash: json['passwordHash'] as String,
      );

  Map<String, dynamic> toJson() => {
        'fullName': fullName,
        'email': email,
        'passwordHash': passwordHash,
      };
}

/// In-memory store — used by tests and as an ephemeral fallback. Not persisted.
class InMemoryAccountStore implements AccountStore {
  InMemoryAccountStore([List<StoredAccount>? seed])
      : _data = List.of(seed ?? const []);

  List<StoredAccount> _data;

  @override
  Future<List<StoredAccount>> readAll() async => List.of(_data);

  @override
  Future<void> writeAll(List<StoredAccount> accounts) async {
    _data = List.of(accounts);
  }
}
