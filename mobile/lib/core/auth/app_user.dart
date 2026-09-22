/// Authenticated user details. Everything the UI shows about the current
/// user is derived from these fields — nothing is hard-coded.
class AppUser {
  final String fullName;
  final String email;

  const AppUser({required this.fullName, required this.email});

  List<String> get _nameParts => fullName
      .trim()
      .split(RegExp(r'\s+'))
      .where((p) => p.isNotEmpty)
      .toList();

  /// First name, used for the greeting.
  String get firstName {
    final parts = _nameParts;
    return parts.isEmpty ? '' : parts.first;
  }

  /// Up to two-letter initials for the avatar.
  String get initials {
    final parts = _nameParts;
    if (parts.isEmpty) return '';
    if (parts.length == 1) {
      final only = parts.first;
      return (only.length == 1 ? only : only.substring(0, 2)).toUpperCase();
    }
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }
}
