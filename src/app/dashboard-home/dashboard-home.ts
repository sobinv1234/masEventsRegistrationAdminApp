import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminSession } from '../admin-dashboard/admin-session';

type Member = {
  membershipNumber: string;
  names: string[];
  phones: string[];
  email: string;
  address?: string;
};

type Registration = { membershipNumber?: string };

type ContactDetailsUpdate = {
  membershipNumber: string;
  address: string;
};

type Event = {
  name: string;
  date: string;
};

const upcomingEvents: Event[] = [
  { name: 'Board Games Day', date: 'Saturday, 28 November 2026' },
  { name: 'Christmas & New Year Celebration', date: 'Saturday, 9 January 2027' },
  { name: 'Badminton Tournament', date: 'Saturday, 16 January 2027' },
  { name: 'Volleyball Tournament', date: 'Saturday, 20 February 2027' },
  { name: 'Football Tournament', date: 'To be confirmed' },
  { name: 'Family Outing', date: 'To be confirmed' },
  { name: 'Nurses Day & Women’s Day', date: 'To be confirmed' },
  { name: 'Sports Day', date: 'To be confirmed' },
  { name: 'Family Day', date: 'To be confirmed' },
  { name: 'Cricket Tournament', date: 'To be confirmed' },
  { name: 'Grand Onam Celebration', date: 'To be confirmed' },
  { name: 'Executive Committee Handover', date: 'To be confirmed' },
];

@Component({
  selector: 'app-dashboard-home',
  imports: [FormsModule, RouterLink],
  templateUrl: './dashboard-home.html',
  styleUrl: './dashboard-home.scss',
})
export class DashboardHome implements OnInit {
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly adminSession = inject(AdminSession);

  protected username = '';
  protected password = '';
  protected searchTerm = '';
  protected members: Member[] = [];
  protected registrations: Registration[] = [];
  protected addressErrorMessage = '';
  protected loggedIn = this.adminSession.isAuthenticated;
  protected loading = false;
  protected errorMessage = '';
  protected readonly events = upcomingEvents;

  private get authorization(): string {
    return this.adminSession.authorization;
  }

  private set authorization(value: string) {
    this.adminSession.authorization = value;
  }

  ngOnInit(): void {
    if (this.loggedIn) {
      void this.refresh();
    }
  }

  protected get filteredMembers(): Member[] {
    const query = this.searchTerm.trim().toLocaleLowerCase();
    if (!query) {
      return this.members;
    }

    return this.members.filter((member) =>
      [
        member.membershipNumber,
        ...member.names,
        ...member.phones,
        member.email,
        member.address ?? '',
      ].some((value) => value.toLocaleLowerCase().includes(query)),
    );
  }

  protected get registeredMembershipCount(): number {
    const registeredNumbers = new Set(
      this.registrations
        .map((registration) => registration.membershipNumber?.trim())
        .filter((number): number is string => Boolean(number)),
    );
    return registeredNumbers.size;
  }

  protected get registrationProgress(): number {
    return this.members.length
      ? Math.min(100, Math.round((this.registrations.length / this.members.length) * 100))
      : 0;
  }

  protected async login(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    this.authorization = `Basic ${this.encodeCredentials(this.username, this.password)}`;
    this.loggedIn = true;
    await this.loadDashboard();
    if (this.errorMessage) {
      this.authorization = '';
      this.loggedIn = false;
    } else {
      this.password = '';
    }
  }

  protected async refresh(): Promise<void> {
    await this.loadDashboard();
  }

  protected downloadExcel(): void {
    if (!this.members.length) {
      return;
    }

    try {
      const blob = new Blob([`\uFEFF${this.buildCsv()}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `MAS-members-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.errorMessage =
        error instanceof Error
          ? `Could not create the member download: ${error.message}`
          : 'Could not create the member download.';
      this.changeDetector.markForCheck();
    }
  }

  protected signOut(): void {
    this.adminSession.signOut();
    this.username = '';
    this.password = '';
    this.searchTerm = '';
    this.members = [];
    this.registrations = [];
    this.addressErrorMessage = '';
    this.loggedIn = false;
    this.errorMessage = '';
  }

  private async loadDashboard(): Promise<void> {
    this.errorMessage = '';
    this.loading = true;
    try {
      const headers = { Authorization: this.authorization };
      const [registrationsResponse, membersResponse] = await Promise.all([
        fetch('/api/admin/registrations', { headers, cache: 'no-store' }),
        fetch('/api/admin/members', { headers, cache: 'no-store' }),
      ]);
      if (!registrationsResponse.ok) {
        throw new Error(await this.getApiError(registrationsResponse, 'Could not load registrations.'));
      }
      if (!membersResponse.ok) {
        throw new Error(await this.getApiError(membersResponse, 'Could not load the member directory.'));
      }

      this.registrations = await registrationsResponse.json();
      this.members = await membersResponse.json();
      await this.loadMemberAddresses(headers);
    } catch (error) {
      this.errorMessage =
        error instanceof TypeError
          ? 'Could not reach the dashboard service. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Could not load dashboard data.';
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  private async loadMemberAddresses(headers: { Authorization: string }): Promise<void> {
    this.addressErrorMessage = '';
    try {
      const response = await fetch('/api/admin/contact-details-updates', {
        headers,
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(await this.getApiError(response, 'Could not load member addresses.'));
      }

      const updates: ContactDetailsUpdate[] = await response.json();
      const addressesByMembership = new Map<string, string>();
      for (const update of updates) {
        const membershipNumber = update.membershipNumber.trim();
        if (membershipNumber && !addressesByMembership.has(membershipNumber)) {
          addressesByMembership.set(membershipNumber, update.address);
        }
      }

      this.members = this.members.map((member) => ({
        ...member,
        address: addressesByMembership.get(member.membershipNumber) ?? '',
      }));
    } catch (error) {
      this.addressErrorMessage =
        error instanceof TypeError
          ? 'Could not reach the contact-details service. Member addresses are unavailable.'
          : error instanceof Error
            ? error.message
            : 'Could not load member addresses.';
    }
  }

  private buildCsv(): string {
    const rows: string[][] = [
      ['Membership number', 'Member name(s)', 'Phone number(s)', 'Email address', 'Address'],
      ...this.members.map((member) => [
        member.membershipNumber,
        member.names.join(', '),
        member.phones.join(', '),
        member.email,
        member.address ?? '',
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

  private async getApiError(response: Response, fallback: string): Promise<string> {
    try {
      const result: { message?: unknown } = await response.json();
      if (typeof result.message === 'string' && result.message) {
        return result.message;
      }
    } catch {
      if (response.status === 404) {
        return 'Dashboard API route was not found (HTTP 404). Check the deployment configuration.';
      }
    }
    return `${fallback} (HTTP ${response.status}).`;
  }

  private encodeCredentials(username: string, password: string): string {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
  }
}
