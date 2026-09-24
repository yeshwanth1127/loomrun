import 'package:flutter/material.dart';

import '../../core/auth/auth.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_typography.dart';
import 'settings_section_page.dart';

class _SettingsItem {
  const _SettingsItem({
    required this.id,
    required this.label,
    required this.subtitle,
    required this.icon,
  });

  final String id;
  final String label;
  final String subtitle;
  final IconData icon;
}

class _SettingsGroup {
  const _SettingsGroup(this.title, this.items);

  final String title;
  final List<_SettingsItem> items;
}

const _groups = [
  _SettingsGroup('Connections', [
    _SettingsItem(
      id: 'connections',
      label: 'Lead sources',
      subtitle: 'Meta, Google, and other inboxes',
      icon: Icons.link_rounded,
    ),
    _SettingsItem(
      id: 'whatsapp',
      label: 'WhatsApp',
      subtitle: 'Number, greeting, and templates',
      icon: Icons.chat_bubble_outline_rounded,
    ),
    _SettingsItem(
      id: 'calling',
      label: 'Calling',
      subtitle: 'Phone providers for this org',
      icon: Icons.smartphone_outlined,
    ),
  ]),
  _SettingsGroup('Brand & documents', [
    _SettingsItem(
      id: 'brand',
      label: 'Brand',
      subtitle: 'Name, address, and bank details',
      icon: Icons.palette_outlined,
    ),
    _SettingsItem(
      id: 'documents',
      label: 'Quote & invoice look',
      subtitle: 'Templates used on documents',
      icon: Icons.description_outlined,
    ),
  ]),
  _SettingsGroup('Team', [
    _SettingsItem(
      id: 'team',
      label: 'People',
      subtitle: 'Who can work in this org',
      icon: Icons.group_outlined,
    ),
  ]),
  _SettingsGroup('Plan & usage', [
    _SettingsItem(
      id: 'plan',
      label: 'Plan',
      subtitle: 'Subscription and seats',
      icon: Icons.credit_card_outlined,
    ),
    _SettingsItem(
      id: 'usage',
      label: 'Usage',
      subtitle: 'WhatsApp and AI this period',
      icon: Icons.insights_outlined,
    ),
  ]),
];

/// Same settings groups as the website, for the active organization.
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  bool get _isOwner {
    final orgId = authController.activeOrgId;
    for (final org in authController.organizations) {
      if (org.orgId == orgId && org.role.toUpperCase() == 'OWNER') return true;
    }
    return false;
  }

  void _open(BuildContext context, _SettingsItem item) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            SettingsSectionPage(sectionId: item.id, title: item.label),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = authController.currentUser;
    final orgName = authController.activeOrgName;
    final initials = (user?.initials.isNotEmpty == true) ? user!.initials : 'U';

    return ColoredBox(
      color: AppColors.surface,
      child: SafeArea(
        bottom: false,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            Text(
              'Settings',
              style: AppTypography.heading(fontSize: 30),
            ),
            const SizedBox(height: 4),
            Text(
              'Organization preferences',
              style: AppTypography.caption(fontSize: 13),
            ),
            const SizedBox(height: 18),
            Container(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    AppColors.primary.withValues(alpha: 0.08),
                    AppColors.surfaceContainerLowest,
                  ],
                ),
                borderRadius: BorderRadius.circular(22),
                border: Border.all(
                  color: AppColors.outlineVariant.withValues(alpha: 0.7),
                ),
              ),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 26,
                    backgroundColor: AppColors.primary,
                    child: Text(
                      initials,
                      style: AppTypography.title(
                        fontSize: 16,
                        fontWeight: FontWeight.w500,
                        color: Colors.white,
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user?.fullName.isNotEmpty == true
                              ? user!.fullName
                              : 'Signed in',
                          style: AppTypography.title(
                            fontSize: 16,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          user?.email ?? '',
                          style: AppTypography.caption(fontSize: 12),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          orgName == null || orgName.isEmpty
                              ? 'Organization'
                              : orgName,
                          style: AppTypography.caption(
                            fontSize: 12,
                            color: AppColors.primary,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 22),
            if (!_isOwner)
              _SettingsCard(
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Text(
                    'Settings are available to the organization owner.',
                    style: AppTypography.body(
                      fontSize: 14,
                      color: AppColors.onSurfaceVariant,
                    ),
                  ),
                ),
              )
            else
              for (final group in _groups) ...[
                Padding(
                  padding: const EdgeInsets.only(left: 6, bottom: 8),
                  child: Text(
                    group.title.toUpperCase(),
                    style: AppTypography.label(),
                  ),
                ),
                _SettingsCard(
                  child: Column(
                    children: [
                      for (var i = 0; i < group.items.length; i++) ...[
                        if (i > 0)
                          Divider(
                            height: 1,
                            indent: 62,
                            color: AppColors.outlineVariant.withValues(
                              alpha: 0.7,
                            ),
                          ),
                        _SettingsRow(
                          item: group.items[i],
                          onTap: () => _open(context, group.items[i]),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 18),
              ],
          ],
        ),
      ),
    );
  }
}

class _SettingsCard extends StatelessWidget {
  const _SettingsCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: AppColors.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: AppColors.outlineVariant.withValues(alpha: 0.7),
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x060F172A),
            blurRadius: 16,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: ClipRRect(borderRadius: BorderRadius.circular(20), child: child),
    );
  }
}

class _SettingsRow extends StatelessWidget {
  const _SettingsRow({required this.item, required this.onTap});

  final _SettingsItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
          child: Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: AppColors.secondaryContainer.withValues(alpha: 0.7),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(item.icon, size: 18, color: AppColors.primary),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.label,
                      style: AppTypography.body(
                        fontSize: 15,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      item.subtitle,
                      style: AppTypography.caption(fontSize: 12),
                    ),
                  ],
                ),
              ),
              Icon(
                Icons.chevron_right_rounded,
                color: AppColors.outline.withValues(alpha: 0.8),
                size: 20,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
