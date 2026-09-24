/// Authenticated user details. Everything the UI shows about the current
/// user is derived from these fields — nothing is hard-coded.
class AppUser {
  final String? id;
  final String fullName;
  final String email;

  const AppUser({
    this.id,
    required this.fullName,
    required this.email,
  });

  List<String> get _nameParts => fullName
      .trim()
      .split(RegExp(r'\s+'))
      .where((p) => p.isNotEmpty)
      .toList();

  /// First name, used for the greeting. An email is never treated as a name.
  String get firstName {
    final parts = _nameParts;
    if (parts.isEmpty) return '';
    final first = parts.first;
    if (first.contains('@')) return '';
    return first;
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

/// One membership row from `GET /v1/auth/me`.
class OrgMembership {
  final String membershipId;
  final String role;
  final String orgId;
  final String orgName;
  final String orgSlug;
  final String plan;
  final bool suspended;

  const OrgMembership({
    required this.membershipId,
    required this.role,
    required this.orgId,
    required this.orgName,
    required this.orgSlug,
    required this.plan,
    required this.suspended,
  });

  factory OrgMembership.fromJson(Map<String, dynamic> json) {
    final org = json['organization'] as Map<String, dynamic>? ?? const {};
    return OrgMembership(
      membershipId: json['membership_id'] as String? ?? '',
      role: json['role'] as String? ?? '',
      orgId: org['id'] as String? ?? '',
      orgName: org['name'] as String? ?? '',
      orgSlug: org['slug'] as String? ?? '',
      plan: org['plan'] as String? ?? '',
      suspended: org['suspended'] as bool? ?? false,
    );
  }
}
