import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AdminSession } from '../admin-dashboard/admin-session';

type ContactUpdate = {
  id: string;
  createdAt: string;
  phone: string;
  membershipNumber: string;
  membershipType: 'individual' | 'family';
  name: string;
  email: string;
  address: string;
  spouseName: string;
  spouseAge: number | null;
  spousePhone: string;
  children: { name: string; age: number | null }[];
  consent: boolean;
};
type ClearSchedule = { requestedAt: string; scheduledFor: string };
type ConfirmationDialog = {
  title: string;
  message: string;
  confirmLabel: string;
  action: 'delete-update' | 'schedule-clear';
};

@Component({
  selector: 'app-contact-details-dashboard',
  imports: [FormsModule, RouterLink],
  templateUrl: './contact-details-dashboard.html',
  styleUrl: './contact-details-dashboard.scss',
})
export class ContactDetailsDashboard implements OnInit {
  private readonly adminSession = inject(AdminSession);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly router = inject(Router);
  protected records: ContactUpdate[] = [];
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

  protected get filteredRecords(): ContactUpdate[] {
    const query = this.searchTerm.trim().toLocaleLowerCase();
    return query
      ? this.records.filter((record) =>
          [
            record.name,
            record.membershipNumber,
            record.phone,
            record.email,
            record.address,
            record.spouseName,
            record.spousePhone,
            ...record.children.map((child) => child.name),
          ].some((value) => value.toLocaleLowerCase().includes(query)),
        )
      : this.records;
  }

  ngOnInit(): void {
    if (!this.loggedIn) {
      void this.router.navigate(['/admin']);
      return;
    }
    void this.refresh();
  }

  protected async refresh(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';
    try {
      const response = await fetch('/api/admin/contact-details-updates', {
        headers: { Authorization: this.adminSession.authorization },
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(await this.getApiError(response, 'Could not load contact details.'));
      }
      this.records = await response.json();
      await this.loadClearSchedule();
    } catch (error) {
      this.errorMessage =
        error instanceof TypeError
          ? 'Could not reach the dashboard service. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Could not load contact details.';
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  protected requestDelete(record: ContactUpdate): void {
    this.pendingDeleteId = record.id;
    this.confirmationDialog = {
      title: 'Delete contact-details submission?',
      message: `Delete the contact-details submission from ${record.name}? This action cannot be undone.`,
      confirmLabel: 'Delete submission',
      action: 'delete-update',
    };
  }

  protected requestClearAll(): void {
    if (this.clearSchedule || this.clearActionLoading) {
      return;
    }
    this.confirmationDialog = {
      title: 'Schedule clear all contact details?',
      message:
        'All contact-detail submissions already in the dashboard will be permanently deleted in 10 days. Later submissions will be kept. You can cancel the scheduled clear before it runs.',
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
      await this.deleteRecord(record);
    }
  }

  protected async deleteRecord(record: ContactUpdate): Promise<void> {
    if (this.pendingDeleteId !== record.id || this.deletingId !== null) {
      return;
    }
    this.errorMessage = '';
    this.deletingId = record.id;
    try {
      const response = await fetch(
        `/api/admin/contact-details-updates/${encodeURIComponent(record.id)}`,
        {
          method: 'DELETE',
          headers: { Authorization: this.adminSession.authorization },
        },
      );
      if (!response.ok) {
        throw new Error(await this.getApiError(response, 'Could not delete this submission.'));
      }
      this.records = this.records.filter((savedRecord) => savedRecord.id !== record.id);
      this.pendingDeleteId = null;
    } catch (error) {
      this.errorMessage =
        error instanceof TypeError
          ? 'Could not reach the dashboard service. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Could not delete this submission.';
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
        '/api/admin/contact-details-updates/clear-schedule',
        {
          method: 'POST',
          headers: { Authorization: this.adminSession.authorization },
        },
      );
      if (!response.ok) {
        throw new Error(await this.getApiError(response, 'Could not schedule the data clear.'));
      }
      const result: { schedule: ClearSchedule } = await response.json();
      this.clearSchedule = result.schedule;
    } catch (error) {
      this.errorMessage =
        error instanceof TypeError
          ? 'Could not reach the dashboard service. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Could not schedule the data clear.';
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
        '/api/admin/contact-details-updates/clear-schedule',
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
    if (!this.records.length) {
      return;
    }
    try {
      const csv = this.buildCsv();
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `MAS-contact-details-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.errorMessage =
        error instanceof Error
          ? `Could not create the contact-details download: ${error.message}`
          : 'Could not create the contact-details download.';
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

  private async loadClearSchedule(): Promise<void> {
    const response = await fetch(
      '/api/admin/contact-details-updates/clear-schedule',
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

  private async getApiError(response: Response, fallback: string): Promise<string> {
    try {
      const result: { message?: string } = await response.json();
      return result.message || fallback;
    } catch {
      return fallback;
    }
  }

  private buildCsv(): string {
    const rows: string[][] = [
      [
        'Membership number',
        'Membership type',
        'Name',
        'Phone',
        'Email',
        'Address',
        'Spouse name',
        'Spouse age',
        'Spouse phone',
        'Children',
        'Consent',
        'Submitted at (UTC)',
      ],
      ...this.records.map((record) => [
        record.membershipNumber,
        record.membershipType === 'family' ? 'Family' : 'Individual',
        record.name,
        record.phone,
        record.email,
        record.address,
        record.spouseName,
        record.spouseAge === null ? '' : String(record.spouseAge),
        record.spousePhone,
        record.children
          .filter((child) => child.name)
          .map((child) =>
            child.age === null ? child.name : `${child.name} (${child.age})`,
          )
          .join('; '),
        record.consent ? 'Agreed' : 'Not agreed',
        record.createdAt,
      ]),
    ];
    return rows
      .map((row) =>
        row
          .map((value) => {
            const safeValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
            return `"${safeValue.replace(/"/g, '""')}"`;
          })
          .join(','),
      )
      .join('\r\n');
  }
}
