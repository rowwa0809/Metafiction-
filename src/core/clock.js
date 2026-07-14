// clock.js — The world's own sense of time.
//
// Model: time is a first-class, perceivable quantity, not a UI overlay.
// NPCs schedule their lives against it (wake, work, eat, sleep), the
// renderer derives day/night lighting from it, and the economy/society
// layers use it to trigger seasons and festivals. The clock never stops
// for the player; it only advances explicitly via tick(), which the
// simulation driver calls whether or not anyone is watching.

export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;
export const DAYS_PER_SEASON = 20;
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length;

export class Clock {
  constructor(totalMinutes = 6 * MINUTES_PER_HOUR) {
    this.totalMinutes = totalMinutes; // start at 06:00 on day 0
  }

  advance(minutes) {
    this.totalMinutes += minutes;
  }

  get minute() {
    return Math.floor(this.totalMinutes) % MINUTES_PER_HOUR;
  }

  get hour() {
    return Math.floor(this.totalMinutes / MINUTES_PER_HOUR) % HOURS_PER_DAY;
  }

  get day() {
    return Math.floor(this.totalMinutes / MINUTES_PER_DAY);
  }

  get dayOfSeason() {
    return this.day % DAYS_PER_SEASON;
  }

  get season() {
    return SEASONS[Math.floor(this.day / DAYS_PER_SEASON) % SEASONS.length];
  }

  get year() {
    return Math.floor(this.day / DAYS_PER_YEAR);
  }

  // Fractional hour-of-day, e.g. 14.5 for 2:30pm — handy for lighting curves.
  get hourFraction() {
    return (this.totalMinutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR;
  }

  isNight() {
    const h = this.hourFraction;
    return h < 5.5 || h >= 20.5;
  }

  isDusk() {
    const h = this.hourFraction;
    return (h >= 18 && h < 20.5) || (h >= 5.5 && h < 7);
  }

  timeString() {
    const h = String(this.hour).padStart(2, '0');
    const m = String(this.minute).padStart(2, '0');
    return `${h}:${m}`;
  }

  dateString() {
    return `${this.season} ${this.dayOfSeason + 1}, Year ${this.year + 1}`;
  }

  serialize() {
    return { totalMinutes: this.totalMinutes };
  }

  static deserialize(data) {
    return new Clock(data.totalMinutes);
  }
}
