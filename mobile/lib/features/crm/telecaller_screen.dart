import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_typography.dart';
import 'follow_ups_controller.dart';
import 'lead_details_screen.dart';
import 'leads_controller.dart';
import 'models/follow_up.dart';
import 'models/lead.dart';

const _mono = 'monospace';

/// Telecaller call queue — today's + overdue follow-ups to work through.
/// Initial version; refine against the web Telecaller screenshot when available.
class TelecallerScreen extends StatelessWidget {
  const TelecallerScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        bottom: false,
        child: ListenableBuilder(
          listenable: Listenable.merge([followUpsController, leadsController]),
          builder: (context, _) {
            final now = DateTime.now();
            final queue = [
              ...followUpsController.overdue(now),
              ...followUpsController.dueToday(now),
            ];

            return CustomScrollView(
              slivers: [
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Telecaller',
                          style: AppTypography.heading(fontSize: 26),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          queue.isEmpty
                              ? 'No calls in the queue right now.'
                              : '${queue.length} '
                                  '${queue.length == 1 ? "call" : "calls"} '
                                  'to work through.',
                          style: const TextStyle(
                            fontSize: 14,
                            color: AppColors.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],
                    ),
                  ),
                ),
                if (queue.isEmpty)
                  const SliverToBoxAdapter(
                    child: Padding(
                      padding: EdgeInsets.fromLTRB(16, 24, 16, 0),
                      child: Text(
                        'Follow-ups due today and overdue follow-ups will show '
                        'up here as a call list.',
                        style: TextStyle(
                          fontSize: 13,
                          height: 1.5,
                          color: AppColors.onSurfaceVariant,
                        ),
                      ),
                    ),
                  )
                else
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                    sliver: SliverList.separated(
                      itemCount: queue.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 10),
                      itemBuilder: (_, i) => _CallCard(
                        followUp: queue[i],
                        overdue: queue[i].isOverdue(now),
                        now: now,
                      ),
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _CallCard extends StatelessWidget {
  final FollowUp followUp;
  final bool overdue;
  final DateTime now;

  const _CallCard({
    required this.followUp,
    required this.overdue,
    required this.now,
  });

  void _openLead(BuildContext context) {
    final match = leadsController.all.where((l) => l.id == followUp.leadId);
    final lead = match.isNotEmpty
        ? match.first
        : Lead(
            id: followUp.leadId,
            name: followUp.customerName,
            company: followUp.company,
            phone: followUp.phone,
            location: '',
            source: LeadSource.whatsapp,
            score: 0,
            status: '',
            stage: LeadStage.newLead,
            value: 0,
            lastActivity: followUp.dateTime,
          );
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => LeadDetailsScreen(lead: lead)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surfaceContainerLowest,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: () => _openLead(context),
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: overdue
                  ? AppColors.error.withValues(alpha: 0.45)
                  : AppColors.outlineVariant,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(
                    overdue
                        ? overdueLabel(followUp.dateTime, now)
                        : formatTime(followUp.dateTime),
                    style: TextStyle(
                      fontFamily: _mono,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: overdue ? AppColors.error : AppColors.primary,
                    ),
                  ),
                  if (followUp.highPriority) ...[
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 1),
                      decoration: BoxDecoration(
                        color: AppColors.warningContainer,
                        borderRadius: BorderRadius.circular(5),
                      ),
                      child: const Text(
                        'HIGH',
                        style: TextStyle(
                          fontFamily: _mono,
                          fontSize: 9,
                          fontWeight: FontWeight.w700,
                          color: AppColors.warning,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 4),
              Text(
                followUp.customerName,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppColors.onSurface,
                ),
              ),
              Text(
                followUp.company,
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                followUp.action,
                style: const TextStyle(
                  fontSize: 13,
                  height: 1.4,
                  color: AppColors.onSurface,
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      followUp.phone,
                      style: const TextStyle(
                        fontFamily: _mono,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.onSurface,
                      ),
                    ),
                  ),
                  _CallButton(phone: followUp.phone),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CallButton extends StatelessWidget {
  final String phone;
  const _CallButton({required this.phone});

  @override
  Widget build(BuildContext context) {
    return FilledButton.icon(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
      ),
      onPressed: () {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            SnackBar(
              backgroundColor: AppColors.inverseSurface,
              behavior: SnackBarBehavior.floating,
              content: Text(
                'Dialing $phone…',
                style: const TextStyle(
                  color: AppColors.inverseOnSurface,
                  fontSize: 13,
                ),
              ),
            ),
          );
      },
      icon: const Icon(Icons.call, size: 15),
      label: const Text('Call'),
    );
  }
}
