import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';

/// Loom Run pipeline stages — aligned with backend `LeadStage` enum.
enum LeadStage {
  newLead,
  contacted,
  requirementCollected,
  quoted,
  negotiation,
  sample,
  won,
  lost;

  String get label => switch (this) {
        LeadStage.newLead => 'New',
        LeadStage.contacted => 'Contacted',
        LeadStage.requirementCollected => 'Requirement Collected',
        LeadStage.quoted => 'Quoted',
        LeadStage.negotiation => 'Negotiation',
        LeadStage.sample => 'Sample Sent',
        LeadStage.won => 'Won',
        LeadStage.lost => 'Lost',
      };

  /// API enum name (`NEW`, `QUALIFICATION`, …).
  String get apiValue => switch (this) {
        LeadStage.newLead => 'NEW',
        LeadStage.contacted => 'CONTACTED',
        LeadStage.requirementCollected => 'QUALIFICATION',
        LeadStage.quoted => 'QUOTATION',
        LeadStage.negotiation => 'NEGOTIATION',
        LeadStage.sample => 'SAMPLE',
        LeadStage.won => 'WON',
        LeadStage.lost => 'LOST',
      };

  bool get isClosed => this == LeadStage.won || this == LeadStage.lost;

  static List<LeadStage> get open =>
      LeadStage.values.where((s) => !s.isClosed).toList();

  static LeadStage fromApi(String? value) {
    switch ((value ?? '').toUpperCase()) {
      case 'NEW':
        return LeadStage.newLead;
      case 'CONTACTED':
        return LeadStage.contacted;
      case 'QUALIFICATION':
        return LeadStage.requirementCollected;
      case 'QUOTATION':
        return LeadStage.quoted;
      case 'NEGOTIATION':
        return LeadStage.negotiation;
      case 'SAMPLE':
        return LeadStage.sample;
      case 'WON':
        return LeadStage.won;
      case 'LOST':
        return LeadStage.lost;
      default:
        return LeadStage.newLead;
    }
  }
}

/// Lead sources — aligned with backend `LeadSource` enum.
enum LeadSource {
  whatsapp,
  telecaller,
  website,
  instagram,
  referral,
  metaAds,
  googleAds,
  indiamart,
  manual,
  other,
  walkIn,
  phoneCall,
  csvImport;

  String get label => switch (this) {
        LeadSource.whatsapp => 'WhatsApp',
        LeadSource.telecaller => 'Telecaller',
        LeadSource.website => 'Website',
        LeadSource.instagram => 'Instagram',
        LeadSource.referral => 'Referral',
        LeadSource.metaAds => 'Meta Ads',
        LeadSource.googleAds => 'Google Ads',
        LeadSource.indiamart => 'IndiaMART',
        LeadSource.manual => 'Manual',
        LeadSource.other => 'Other',
        LeadSource.walkIn => 'Walk-in',
        LeadSource.phoneCall => 'Call',
        LeadSource.csvImport => 'Import',
      };

  /// Value accepted by the API create/update body.
  String get apiValue => switch (this) {
        LeadSource.whatsapp => 'WHATSAPP',
        LeadSource.telecaller => 'TELECALLER',
        LeadSource.website => 'WEBSITE',
        LeadSource.instagram => 'INSTAGRAM',
        LeadSource.referral => 'REFERRAL',
        LeadSource.metaAds => 'META_ADS',
        LeadSource.googleAds => 'GOOGLE_ADS',
        LeadSource.indiamart => 'INDIAMART',
        LeadSource.manual => 'MANUAL',
        LeadSource.other => 'OTHER',
        LeadSource.walkIn => 'OTHER',
        LeadSource.phoneCall => 'TELECALLER',
        LeadSource.csvImport => 'MANUAL',
      };

  static LeadSource fromApi(String? value) {
    switch ((value ?? '').toUpperCase()) {
      case 'WHATSAPP':
        return LeadSource.whatsapp;
      case 'TELECALLER':
        return LeadSource.telecaller;
      case 'WEB':
      case 'WEBSITE':
        return LeadSource.website;
      case 'INSTAGRAM':
        return LeadSource.instagram;
      case 'REFERRAL':
        return LeadSource.referral;
      case 'META_ADS':
        return LeadSource.metaAds;
      case 'GOOGLE_ADS':
        return LeadSource.googleAds;
      case 'INDIAMART':
        return LeadSource.indiamart;
      case 'MANUAL':
        return LeadSource.manual;
      default:
        return LeadSource.other;
    }
  }
}

class Lead {
  final String id;
  final String name;
  final String company;
  final String phone;
  final String email;
  final String location;
  final LeadSource source;
  final int score;
  final String status;
  final LeadStage stage;
  final double value;
  final DateTime lastActivity;
  final DateTime? nextFollowUpAt;
  final String? notes;
  final String? lastCallOutcome;

  const Lead({
    required this.id,
    required this.name,
    required this.company,
    required this.phone,
    this.email = '',
    required this.location,
    required this.source,
    required this.score,
    required this.status,
    required this.stage,
    required this.value,
    required this.lastActivity,
    this.nextFollowUpAt,
    this.notes,
    this.lastCallOutcome,
  });

  Lead copyWith({
    LeadStage? stage,
    DateTime? nextFollowUpAt,
    bool clearNextFollowUp = false,
    String? notes,
    String? status,
  }) =>
      Lead(
        id: id,
        name: name,
        company: company,
        phone: phone,
        email: email,
        location: location,
        source: source,
        score: score,
        status: status ?? this.status,
        stage: stage ?? this.stage,
        value: value,
        lastActivity: lastActivity,
        nextFollowUpAt:
            clearNextFollowUp ? null : (nextFollowUpAt ?? this.nextFollowUpAt),
        notes: notes ?? this.notes,
        lastCallOutcome: lastCallOutcome,
      );

  factory Lead.fromApi(Map<String, dynamic> json) {
    final lastActivityRaw =
        json['last_activity_at'] as String? ?? json['updated_at'] as String?;
    final nextFu = json['next_follow_up_at'] as String?;
    final outcome = json['last_call_outcome'] as String?;
    return Lead(
      id: json['id'] as String? ?? '',
      name: (json['title'] as String?)?.trim().isNotEmpty == true
          ? (json['title'] as String).trim()
          : (json['company'] as String?)?.trim() ?? 'Untitled',
      company: (json['company'] as String?) ?? '',
      phone: (json['phone'] as String?) ?? '',
      email: (json['email'] as String?) ?? '',
      location: (json['city'] as String?) ?? '',
      source: LeadSource.fromApi(json['source'] as String?),
      score: (json['lead_score'] as num?)?.toInt() ?? 0,
      status: outcome?.replaceAll('_', ' ') ??
          (json['lead_status'] as String?)?.replaceAll('_', ' ') ??
          '',
      stage: LeadStage.fromApi(json['stage'] as String?),
      value: (json['estimated_value'] as num?)?.toDouble() ?? 0,
      lastActivity: _parseDate(lastActivityRaw) ?? DateTime.now(),
      nextFollowUpAt: _parseDate(nextFu),
      notes: json['notes'] as String?,
      lastCallOutcome: outcome,
    );
  }

  static DateTime? _parseDate(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    return DateTime.tryParse(raw)?.toLocal();
  }
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
