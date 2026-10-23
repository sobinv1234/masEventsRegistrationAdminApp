import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AdminSession } from '../admin-dashboard/admin-session';

type RenewalChild = { name: string; age: number | null };
type RenewalRecord = {
  id: string;
  createdAt: string;
  mobileNumber?: string;
  email: string;
  membershipType: 'individual' | 'family';
  membershipNumber: string;
  membershipHolderName: string;
  memberAge: number;
  spouseName: string;
  spouseAge: number | null;
  children: RenewalChild[];
  otherFamilyMembers: string;
  address: string;
  postcode: string;
  phone: string;
  spousePhone: string;
  additionalPhones: string;
  consent: boolean;
};
type ClearSchedule = { requestedAt: string; scheduledFor: string };
type ConfirmationDialog = {
  title: string;
  message: string;
  confirmLabel: string;
  action: 'delete-renewal' | 'schedule-clear';
};

@Component({
  selector: 'app-membership-renewals-dashboard',
  imports: [FormsModule, RouterLink],
  templateUrl: './membership-renewals-dashboard.html',
  styleUrl: './membership-renewals-dashboard.scss',
})
export class MembershipRenewalsDashboard implements OnInit {
  private readonly adminSession = inject(AdminSession);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly router = inject(Router);
  protected records: RenewalRecord[] = [];
  protected searchTerm = '';
  protected loading = false;
  protected errorMessage = '';
  protected clearSchedule: ClearSchedule | null = null;
  protected confirmationDialog: ConfirmationDialog | null = null;
  protected pendingDeleteId: string | null = null;
  protected deletingId: string | null = null;
  protected clearActionLoading = false;

  protected get loggedIn(): boolean {
    return this.adminSession.isAuthenticated;
  }

  protected get filteredRecords(): RenewalRecord[] {
    const query = this.searchTerm.trim().toLocaleLowerCase();
    if (!query) {
      return this.records;
    }
    return this.records.filter((record) =>
      [
        record.membershipNumber,
        record.mobileNumber ?? '',
        record.membershipHolderName,
        record.email,
        record.phone,
        record.postcode,
      ].some((value) => value.toLocaleLowerCase().includes(query)),
    );
  }

  ngOnInit(): void {
    if (!this.adminSession.isAuthenticated) {
      void this.router.navigate(['/admin']);
      return;
    }
    void this.refresh();
  }

  protected async refresh(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';
    try {
      const response = await fetch('/api/admin/membership-renewals', {
        headers: { Authorization: this.adminSession.authorization },
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(await this.getApiError(response, 'Could not load renewal members.'));
      }
      this.records = await response.json();
      await this.loadClearSchedule();
    } catch (error) {
      this.errorMessage =
        error instanceof TypeError
          ? 'Could not reach the dashboard service. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Could not load renewal members.';
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  protected requestDelete(record: RenewalRecord): void {
    this.pendingDeleteId = record.id;
    this.confirmationDialog = {
      title: 'Delete membership renewal?',
      message: `Delete the renewal submitted by ${record.membershipHolderName}? This action cannot be undone.`,
      confirmLabel: 'Delete renewal',
      action: 'delete-renewal',
    };
  }

  protected requestClearAll(): void {
    if (this.clearSchedule || this.clearActionLoading) {
      return;
    }
    this.confirmationDialog = {
      title: 'Schedule clear all renewal data?',
      message:
        'All membership renewals already in the dashboard will be permanently deleted in 10 days. Renewals submitted after scheduling will be kept. You can cancel the scheduled clear before it runs.',
      confirmLabel: 'Schedule clear',
      action: 'schedule-clear',
    };
  }

  protected cancelConfirmation(): void {
    this.pendingDeleteId = null;
    this.confirmationDialog = null;
  }

  protected async confirmDialogAction(): Promise<void> {
    const dialog = this.confirmationDialog;
    if (!dialog) {
      return;
    }
    this.confirmationDialog = null;
    if (dialog.action === 'schedule-clear') {
      await this.scheduleClearAll();
      return;
    }
    const record = this.records.find((item) => item.id === this.pendingDeleteId);
    if (record) {
      await this.deleteRenewal(record);
    }
  }

  protected async deleteRenewal(record: RenewalRecord): Promise<void> {
    if (this.pendingDeleteId !== record.id || this.deletingId !== null) {
      return;
    }
    this.errorMessage = '';
    this.deletingId = record.id;
    try {
      const response = await fetch(
        `/api/admin/membership-renewals/${encodeURIComponent(record.id)}`,
        {
          method: 'DELETE',
          headers: { Authorization: this.adminSession.authorization },
        },
      );
      if (!response.ok) {
        throw new Error(await this.getApiError(response, 'Could not delete this renewal.'));
      }
      this.records = this.records.filter((savedRecord) => savedRecord.id !== record.id);
      this.pendingDeleteId = null;
    } catch (error) {
      this.errorMessage =
        error instanceof TypeError
          ? 'Could not reach the dashboard service. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Could not delete this renewal.';
    } finally {
      this.deletingId = null;
      this.changeDetector.markForCheck();
    }
  }

  protected async scheduleClearAll(): Promise<void> {
    this.errorMessage = '';
    this.clearActionLoading = true;
    try {
      const response = await fetch(
        '/api/admin/membership-renewals/clear-schedule',
        {
          method: 'POST',
          headers: { Authorization: this.adminSession.authorization },
        },
      );
      if (!response.ok) {
        throw new Error(await this.getApiError(response, 'Could not schedule the renewal clear.'));
      }
      const result: { schedule: ClearSchedule } = await response.json();
      this.clearSchedule = result.schedule;
    } catch (error) {
      this.errorMessage =
        error instanceof TypeError
          ? 'Could not reach the dashboard service. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Could not schedule the renewal clear.';
    } finally {
      this.clearActionLoading = false;
      this.changeDetector.markForCheck();
    }
  }

  protected async cancelScheduledClear(): Promise<void> {
    this.errorMessage = '';
    this.clearActionLoading = true;
    try {
      const response = await fetch(
        '/api/admin/membership-renewals/clear-schedule',
        {
          method: 'DELETE',
          headers: { Authorization: this.adminSession.authorization },
        },
      );
      if (!response.ok) {
        throw new Error(await this.getApiError(response, 'Could not cancel the scheduled clear.'));
      }
      this.clearSchedule = null;
    } catch (error) {
      this.errorMessage =
        error instanceof TypeError
          ? 'Could not reach the dashboard service. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Could not cancel the scheduled clear.';
    } finally {
      this.clearActionLoading = false;
      this.changeDetector.markForCheck();
    }
  }

  protected downloadExcel(): void {
    if (this.records.length === 0) {
      return;
    }
    try {
      const csv = this.buildCsv();
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `MAS-membership-renewals-2026-27-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.errorMessage =
        error instanceof Error
          ? `Could not create the renewal download: ${error.message}`
          : 'Could not create the renewal download.';
      this.changeDetector.markForCheck();
    }
  }

  protected signOut(): void {
    this.adminSession.signOut();
    void this.router.navigate(['/admin']);
  }

  protected formatDate(value: string): string {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  private async getApiError(response: Response, fallback: string): Promise<string> {
    try {
      const result: { message?: string } = await response.json();
      return result.message || fallback;
    } catch {
      return fallback;
    }
  }

  private async loadClearSchedule(): Promise<void> {
    const response = await fetch(
      '/api/admin/membership-renewals/clear-schedule',
      {
        headers: { Authorization: this.adminSession.authorization },
        cache: 'no-store',
      },
    );
    if (!response.ok) {
      throw new Error(await this.getApiError(response, 'Could not load scheduled clear status.'));
    }
    const result: { schedule: ClearSchedule | null } = await response.json();
    this.clearSchedule = result.schedule;
  }

  private buildCsv(): string {
    const rows: (string | number)[][] = [
      [
        'Membership number',
        'Directory mobile number',
        'Membership holder',
        'Membership type',
        'Member age',
        'Email',
        'Phone',
        'Address',
        'Postcode',
        'Spouse name',
        'Spouse age',
        'Spouse phone',
        'Children',
        'Other family members',
        'Additional phones',
        'Consent',
        'Submitted at (UTC)',
      ],
      ...this.records.map((record) => [
        record.membershipNumber,
        record.mobileNumber ?? '',
        record.membershipHolderName,
        record.membershipType === 'family' ? 'Family (£30)' : 'Individual (£20)',
        record.memberAge,
        record.email,
        record.phone,
        record.address,
        record.postcode,
        record.spouseName,
        record.spouseAge ?? '',
        record.spousePhone,
        record.children
          .filter((child) => child.name)
          .map((child) => `${child.name}${child.age === null ? '' : ` (age ${child.age})`}`)
          .join('; '),
        record.otherFamilyMembers,
        record.additionalPhones,
        record.consent ? 'Agreed' : 'Not agreed',
        record.createdAt,
      ]),
    ];

    return rows
      .map((row) =>
        row
          .map((value) => {
            const text = String(value);
            const safeText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
            return `"${safeText.replace(/"/g, '""')}"`;
          })
          .join(','),
      )
      .join('\r\n');
  }
}
