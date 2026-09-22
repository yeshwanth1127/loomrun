import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';

/// Loom Run pipeline stages, in board order.
/// `Won` and `Lost` are closed stages (hidden unless "Show closed" is on).
enum LeadStage {
  newLead,
  contacted,
  requirementCollected,
  quoted,
  negotiation,
  won,
  lost;

  String get label => switch (this) {
        LeadStage.newLead => 'New',
        LeadStage.contacted => 'Contacted',
        LeadStage.requirementCollected => 'Requirement Collected',
        LeadStage.quoted => 'Quoted',
        LeadStage.negotiation => 'Negotiation',
        LeadStage.won => 'Won',
        LeadStage.lost => 'Lost',
      };

  bool get isClosed => this == LeadStage.won || this == LeadStage.lost;

  static List<LeadStage> get open =>
      LeadStage.values.where((s) => !s.isClosed).toList();
}

/// Where the lead came from (the "All Sources" filter).
enum LeadSource {
  whatsapp,
  website,
  referral,
  walkIn,
  phoneCall,
  instagram,
  csvImport;

  String get label => switch (this) {
        LeadSource.whatsapp => 'WhatsApp',
        LeadSource.website => 'Website',
        LeadSource.referral => 'Referral',
        LeadSource.walkIn => 'Walk-in',
        LeadSource.phoneCall => 'Call',
        LeadSource.instagram => 'Instagram',
        LeadSource.csvImport => 'Import',
      };
}

class Lead {
  final String id;
  final String name;
  final String company;
  final String phone;
  final String location;
  final LeadSource source;

  /// 0–100 lead score (drives the accent colour and the Score min/max filter).
  final int score;

  /// Last call disposition / status, e.g. "Busy", "Interested".
  final String status;

  final LeadStage stage;
  final double value;
  final DateTime lastActivity;

  const Lead({
    required this.id,
    required this.name,
    required this.company,
    required this.phone,
    required this.location,
    required this.source,
    required this.score,
    required this.status,
    required this.stage,
    required this.value,
    required this.lastActivity,
  });

  Lead copyWith({LeadStage? stage}) => Lead(
        id: id,
        name: name,
        company: company,
        phone: phone,
        location: location,
        source: source,
        score: score,
        status: status,
        stage: stage ?? this.stage,
        value: value,
        lastActivity: lastActivity,
      );
}

/// Score band colour, also used for the card's left accent strip.
Color scoreColor(int score) {
  if (score >= 70) return AppColors.success; // strong
  if (score >= 40) return AppColors.warning; // warm
  return AppColors.outline; // cool
}

/// Indian-format currency: ₹10,000 · ₹1,20,000 · ₹4,00,00,000
String formatInr(num amount) {
  final digits = amount.round().abs().toString();
  final sign = amount < 0 ? '-' : '';
  if (digits.length <= 3) return '$sign₹$digits';
  final last3 = digits.substring(digits.length - 3);
  final head = digits.substring(0, digits.length - 3);
  final grouped =
      head.replaceAllMapped(RegExp(r'\B(?=(\d{2})+(?!\d))'), (_) => ',');
  return '$sign₹$grouped,$last3';
}

/// "just now" · "50m ago" · "3h ago" · "Yesterday" · "5d ago" · "12 Aug"
String formatRelative(DateTime time, [DateTime? now]) {
  final ref = now ?? DateTime.now();
  final diff = ref.difference(time);
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (diff.inHours < 24) return '${diff.inHours}h ago';
  if (diff.inDays == 1) return 'Yesterday';
  if (diff.inDays < 7) return '${diff.inDays}d ago';
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', //
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return '${time.day} ${months[time.month - 1]}';
}
