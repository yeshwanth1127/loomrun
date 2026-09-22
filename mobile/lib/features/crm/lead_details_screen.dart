import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_typography.dart';
import 'models/lead.dart';

/// Placeholder — full lead detail / activity timeline comes later.
class LeadDetailsScreen extends StatelessWidget {
  final Lead lead;

  const LeadDetailsScreen({super.key, required this.lead});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        title: const Text(
          'Lead Details',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: AppColors.onSurface,
          ),
        ),
        iconTheme: const IconThemeData(color: AppColors.onSurface),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          Text(
            lead.name,
            style: AppTypography.heading(fontSize: 26),
          ),
          const SizedBox(height: 4),
          Text(
            lead.company.isEmpty ? lead.phone : lead.company,
            style: const TextStyle(
              fontSize: 14,
              color: AppColors.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 28),
          _DetailRow(label: 'STAGE', value: lead.stage.label),
          _DetailRow(
            label: 'SCORE',
            value: '${lead.score}',
            valueColor: scoreColor(lead.score),
          ),
          if (lead.status.isNotEmpty)
            _DetailRow(label: 'STATUS', value: lead.status),
          _DetailRow(label: 'SOURCE', value: lead.source.label),
          _DetailRow(label: 'PHONE', value: lead.phone),
          if (lead.location.isNotEmpty)
            _DetailRow(label: 'LOCATION', value: lead.location),
          _DetailRow(label: 'VALUE', value: formatInr(lead.value)),
          _DetailRow(
            label: 'LAST ACTIVITY',
            value: formatRelative(lead.lastActivity),
          ),
          const SizedBox(height: 32),
          Container(
            padding: const EdgeInsets.only(left: 12),
            decoration: const BoxDecoration(
              border: Border(
                left: BorderSide(color: AppColors.primary, width: 2),
              ),
            ),
            child: const Text(
              'Full lead details, notes and activity history will live here.',
              style: TextStyle(
                fontSize: 13,
                height: 1.6,
                color: AppColors.onSurface,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;

  const _DetailRow({required this.label, required this.value, this.valueColor});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Color(0x33E5E9EE))),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(
              label,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 11,
                fontWeight: FontWeight.bold,
                letterSpacing: 1,
                color: AppColors.outline,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontSize: 15,
                color: valueColor ?? AppColors.onSurface,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
