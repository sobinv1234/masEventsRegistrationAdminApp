import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

type ContactMatch = {
  membershipNumber: string;
  name: string;
};

@Component({
  selector: 'app-contact-details',
  imports: [FormsModule, RouterLink],
  templateUrl: './contact-details.html',
  styleUrl: './contact-details.scss',
})
export class ContactDetailsForm {
  private readonly changeDetector = inject(ChangeDetectorRef);
  protected phone = '';
  protected membershipNumber = '';
  protected name = '';
  protected email = '';
  protected address = '';
  protected consent = false;
  protected matches: ContactMatch[] = [];
  protected selectedMatch = -1;
  protected lookupMessage = '';
  protected errorMessage = '';
  protected successMessage = '';
  protected lookingUp = false;
  protected submitting = false;
  protected submitted = false;

  protected onPhoneChanged(): void {
    this.membershipNumber = '';
    this.name = '';
    this.email = '';
    this.matches = [];
    this.selectedMatch = -1;
    this.lookupMessage = '';
    this.errorMessage = '';
  }

  protected async lookupPhone(): Promise<void> {
    const phone = this.phone.trim();
    if (!phone || this.lookingUp) {
      return;
    }
    this.lookingUp = true;
    this.lookupMessage = '';
    this.errorMessage = '';
    try {
      const response = await fetch('/api/membership-phone-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
        cache: 'no-store',
      });
      if (response.status === 404) {
        this.matches = [];
        this.membershipNumber = '';
        this.lookupMessage =
          'No matching member was found. You can still submit your contact details.';
        return;
      }
      if (!response.ok) {
        throw new Error(await this.getApiError(response, 'Could not look up this phone number.'));
      }
      const result: {
        matches: { membershipNumber: string; names: string[] }[];
      } = await response.json();
      this.matches = result.matches.flatMap((match) =>
        match.names.map((name) => ({
          membershipNumber: match.membershipNumber,
          name,
        })),
      );
      if (this.matches.length === 1) {
        this.selectMatch(0);
        this.lookupMessage = 'Member details found. Please check and complete your details.';
      } else {
        this.lookupMessage = 'More than one member matches. Please select your name.';
      }
    } catch (error) {
      this.errorMessage =
        error instanceof TypeError
          ? 'Could not reach the member lookup service. You can still enter your details manually.'
          : error instanceof Error
            ? error.message
            : 'Could not look up this phone number.';
    } finally {
      this.lookingUp = false;
      this.changeDetector.markForCheck();
    }
  }

  protected selectMatch(index: number): void {
    const match = this.matches[index];
    if (!match) {
      this.membershipNumber = '';
      return;
    }
    this.selectedMatch = index;
    this.membershipNumber = match.membershipNumber;
    this.name = match.name;
  }

  protected async submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (this.submitting || this.submitted) {
      return;
    }
    this.errorMessage = '';
    this.successMessage = '';
    this.submitting = true;
    try {
      const response = await fetch('/api/contact-details-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: this.phone,
          membershipNumber: this.membershipNumber,
          name: this.name,
          email: this.email,
          address: this.address,
          consent: this.consent,
        }),
      });
      const result: { message?: string } = await response.json();
      if (!response.ok) {
        throw new Error(result.message || 'Could not submit your contact details.');
      }
      this.successMessage =
        result.message || 'Your contact details have been submitted.';
      this.submitted = true;
    } catch (error) {
      this.errorMessage =
        error instanceof TypeError
          ? 'Could not reach the contact-details service. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Could not submit your contact details.';
    } finally {
      this.submitting = false;
      this.changeDetector.markForCheck();
    }
  }

  private async getApiError(response: Response, fallback: string): Promise<string> {
    try {
      const result: { message?: string } = await response.json();
      return result.message || fallback;
    } catch {
      return fallback;
    }
  }
}
