import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

type Game = 'Carroms' | 'Chess' | 'PlayStation' | 'Cards';

@Component({
  selector: 'app-registration',
  imports: [FormsModule],
  templateUrl: './registration.html',
  styleUrl: './registration.scss',
})
export class Registration {
  private readonly changeDetector = inject(ChangeDetectorRef);
  protected readonly games: Game[] = ['Carroms', 'Chess', 'PlayStation'];
  protected name = '';
  protected age: number | null = null;
  protected phone = '';
  protected email = '';
  protected guardian = '';
  protected consent = false;
  protected selectedGames: Game[] = [];
  protected submitting = false;
  protected registrationComplete = false;
  protected errorMessage = '';
  protected successMessage = '';

  protected get minor(): boolean {
    return this.age !== null && this.age < 18;
  }

  protected get ageCategory(): string {
    if (this.age === null || this.age < 8) {
      return '';
    }
    if (this.age <= 13) {
      return '8–13';
    }
    if (this.age <= 17) {
      return '14–17';
    }
    return '18+';
  }

  protected onAgeChange(): void {
    if (this.age === null || this.age < 18) {
      this.selectedGames = this.selectedGames.filter((game) => game !== 'Cards');
    }
    if (!this.minor) {
      this.guardian = '';
    }
  }

  protected toggleGame(game: Game, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked && !this.selectedGames.includes(game)) {
      this.selectedGames = [...this.selectedGames, game];
    } else if (!checked) {
      this.selectedGames = this.selectedGames.filter((selected) => selected !== game);
    }
  }

  protected async submit(): Promise<void> {
    this.errorMessage = '';
    this.successMessage = '';
    if (!this.age || this.age < 8 || !this.selectedGames.length) {
      this.errorMessage = 'Enter an eligible age and select at least one game.';
      return;
    }
    if (this.age < 18 && !this.guardian.trim()) {
      this.errorMessage = 'A parent or guardian name is required for participants under 18.';
      return;
    }

    this.submitting = true;
    try {
      const response = await fetch('/api/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: this.name.trim(),
          age: this.age,
          phone: this.phone.trim(),
          email: this.email.trim(),
          guardian: this.minor ? this.guardian.trim() : '',
          games: this.selectedGames,
          consent: this.consent,
        }),
      });
      const result: { message?: string; registrationSaved?: boolean } =
        await response.json();
      if (!response.ok) {
        if (result.registrationSaved) {
          this.successMessage = result.message ?? 'Your registration was saved.';
          this.registrationComplete = true;
          this.clearForm();
          this.changeDetector.markForCheck();
          return;
        }
        throw new Error(result.message ?? 'Registration could not be submitted.');
      }
      this.successMessage =
        result.message ?? 'Thank you! Your registration has been submitted to MAS.';
      this.registrationComplete = true;
      this.clearForm();
      this.changeDetector.markForCheck();
    } catch (error) {
      this.errorMessage =
        error instanceof TypeError
          ? 'We could not reach the registration service. Please try again later.'
          : error instanceof Error
            ? error.message
            : 'Registration could not be submitted.';
      this.changeDetector.markForCheck();
    } finally {
      this.submitting = false;
      this.changeDetector.markForCheck();
    }
  }

  private clearForm(): void {
    this.name = '';
    this.age = null;
    this.phone = '';
    this.email = '';
    this.guardian = '';
    this.consent = false;
    this.selectedGames = [];
  }
}
