import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

type RegistrationRecord = {
  id: string;
  createdAt: string;
  name: string;
  age: number;
  phone: string;
  email: string;
  guardian: string;
  games: { game: string; category: string }[];
  emailSent: boolean;
};

type AgeFilter = 'all' | '8-13' | '14-17' | '18-plus';
type GameFilter = 'all' | RegistrationRecord['games'][number]['game'];
type EmailFilter = 'all' | 'sent' | 'pending';
type PageSize = 10 | 25 | 50;

@Component({
  selector: 'app-admin-dashboard',
  imports: [FormsModule],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.scss',
})
export class AdminDashboard {
  private readonly changeDetector = inject(ChangeDetectorRef);
  protected username = '';
  protected password = '';
  protected records: RegistrationRecord[] = [];
  protected searchTerm = '';
  protected ageFilter: AgeFilter = 'all';
  protected gameFilter: GameFilter = 'all';
  protected emailFilter: EmailFilter = 'all';
  protected pageSize: PageSize = 10;
  protected currentPage = 1;
  protected loading = false;
  protected loggedIn = false;
  protected errorMessage = '';
  protected pendingDeleteId: string | null = null;
  protected deletingId: string | null = null;
  private authorization = '';

  protected get filteredRecords(): RegistrationRecord[] {
    const query = this.searchTerm.trim().toLocaleLowerCase();

    return this.records.filter((record) => {
      const matchesSearch =
        !query ||
        [record.name, record.email, record.phone, record.guardian].some((value) =>
          value.toLocaleLowerCase().includes(query),
        );
      const matchesAge =
        this.ageFilter === 'all' ||
        (this.ageFilter === '8-13' && record.age >= 8 && record.age <= 13) ||
        (this.ageFilter === '14-17' && record.age >= 14 && record.age <= 17) ||
        (this.ageFilter === '18-plus' && record.age >= 18);
      const matchesGame =
        this.gameFilter === 'all' ||
        record.games.some((choice) => choice.game === this.gameFilter);
      const matchesEmail =
        this.emailFilter === 'all' ||
        (this.emailFilter === 'sent' && record.emailSent) ||
        (this.emailFilter === 'pending' && !record.emailSent);

      return matchesSearch && matchesAge && matchesGame && matchesEmail;
    });
  }

  protected get hasActiveFilters(): boolean {
    return (
      this.searchTerm.trim() !== '' ||
      this.ageFilter !== 'all' ||
      this.gameFilter !== 'all' ||
      this.emailFilter !== 'all'
    );
  }

  protected get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredRecords.length / this.pageSize));
  }

  protected get paginatedRecords(): RegistrationRecord[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredRecords.slice(start, start + this.pageSize);
  }

  protected get firstVisibleRecord(): number {
    return this.filteredRecords.length === 0
      ? 0
      : (this.currentPage - 1) * this.pageSize + 1;
  }

  protected get lastVisibleRecord(): number {
    return Math.min(this.currentPage * this.pageSize, this.filteredRecords.length);
  }

  protected onFiltersChanged(): void {
    this.currentPage = 1;
  }

  protected goToPage(page: number): void {
    this.currentPage = Math.min(Math.max(1, page), this.totalPages);
  }

  protected requestDelete(record: RegistrationRecord): void {
    this.pendingDeleteId = record.id;
  }

  protected cancelDelete(): void {
    this.pendingDeleteId = null;
  }

  protected async deleteRegistration(record: RegistrationRecord): Promise<void> {
    if (this.pendingDeleteId !== record.id || this.deletingId !== null) {
      return;
    }

    this.errorMessage = '';
    this.deletingId = record.id;
    try {
      const response = await fetch(
        `/api/admin/registrations/${encodeURIComponent(record.id)}`,
        {
          method: 'DELETE',
          headers: { Authorization: this.authorization },
        },
      );
      if (!response.ok) {
        const result: { message?: string } = await response.json();
        throw new Error(result.message ?? 'Could not delete this registration.');
      }

      this.records = this.records.filter((savedRecord) => savedRecord.id !== record.id);
      this.pendingDeleteId = null;
      this.currentPage = Math.min(this.currentPage, this.totalPages);
    } catch (error) {
      this.errorMessage =
        error instanceof TypeError
          ? 'Could not reach the dashboard service. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Could not delete this registration.';
    } finally {
      this.deletingId = null;
      this.changeDetector.markForCheck();
    }
  }

  protected clearFilters(): void {
    this.searchTerm = '';
    this.ageFilter = 'all';
    this.gameFilter = 'all';
    this.emailFilter = 'all';
    this.currentPage = 1;
  }

  protected async login(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    this.errorMessage = '';
    this.loading = true;
    this.authorization = `Basic ${this.encodeCredentials(this.username, this.password)}`;
    try {
      const response = await fetch('/api/admin/registrations', {
        headers: { Authorization: this.authorization },
        cache: 'no-store',
      });
      if (response.status === 401) {
        throw new Error('Username or password is incorrect.');
      }
      if (!response.ok) {
        throw new Error(await this.getApiError(response, 'Could not sign in.'));
      }
      this.records = await response.json();
      this.loggedIn = true;
      this.password = '';
      this.changeDetector.markForCheck();
    } catch (error) {
      this.authorization = '';
      this.errorMessage =
        error instanceof TypeError
          ? 'Could not reach the dashboard service. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Could not sign in.';
      this.changeDetector.markForCheck();
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  protected async refresh(): Promise<void> {
    this.errorMessage = '';
    this.loading = true;
    try {
      const response = await fetch('/api/admin/registrations', {
        headers: { Authorization: this.authorization },
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(
          await this.getApiError(response, 'Could not load registrations.'),
        );
      }
      this.records = await response.json();
      this.changeDetector.markForCheck();
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : 'Could not load registrations.';
      this.changeDetector.markForCheck();
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  protected async retryEmail(record: RegistrationRecord): Promise<void> {
    this.errorMessage = '';
    try {
      const response = await fetch(
        `/api/admin/registrations/${encodeURIComponent(record.id)}/email`,
        {
          method: 'POST',
          headers: { Authorization: this.authorization },
        },
      );
      if (!response.ok) {
        throw new Error(
          await this.getApiError(response, 'Could not send the email notification.'),
        );
      }
      record.emailSent = true;
      this.changeDetector.markForCheck();
    } catch (error) {
      this.errorMessage =
        error instanceof TypeError
          ? 'Could not reach the dashboard service. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Could not send the email notification.';
      this.changeDetector.markForCheck();
    }
  }

  protected signOut(): void {
    this.authorization = '';
    this.username = '';
    this.password = '';
    this.records = [];
    this.pendingDeleteId = null;
    this.deletingId = null;
    this.loggedIn = false;
  }

  private async getApiError(response: Response, fallback: string): Promise<string> {
    try {
      const result: { message?: unknown } = await response.json();
      if (typeof result.message === 'string' && result.message) {
        return result.message;
      }
    } catch {
      if (response.status === 404) {
        return 'Dashboard API route was not found (HTTP 404). Check the Vercel function deployment.';
      }
    }
    return `${fallback} (HTTP ${response.status}).`;
  }

  protected formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }

  private encodeCredentials(username: string, password: string): string {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
  }
}
