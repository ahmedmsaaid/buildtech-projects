/**
 * The words each product uses for the same things. A barbershop runs on the
 * clinic's booking system and a café on the restaurant's ordering system;
 * what differs is what they call their place, their customers and their
 * work. Pages take those words from here instead of writing "clinic" or
 * "restaurant" themselves.
 *
 * A product is listed in exactly one of the two tables below, which is also
 * what says which system it runs on.
 */

/** Words for products that take bookings (the pages under /admin and /site/clinic). */
export interface BookingWords {
  /** The place, with "the": العيادة. */
  place: string;
  /** "For the place": للعيادة. */
  toPlace: string;
  /** "The place is closed", agreeing in gender: العيادة مقفولة. */
  placeClosed: string;
  /** "The place will remind you": العيادة هتفكّرك. */
  placeReminds: string;
  /** What the settings page is about, agreeing in gender. */
  settingsSubtitle: string;
  /** The person who books, with "the" and without: المريض / مريض. */
  client: string;
  client1: string;
  /** The same, plural: المرضى / مرضى. */
  clients: string;
  clients1: string;
  /** Who does the work, with "the": الدكتور. */
  pro: string;
  /** What the specialty field asks for. */
  specialtyLabel: string;
  /** A finished visit, as staff see it and as the visitor is told. */
  done: string;
  doneForClient: string;
  /** What a new account can book before it adds its own services. */
  firstService: string;
  /** What to write in a client's private note, and examples of single days off. */
  notePlaceholder: string;
  closedExamples: string;
  /** What a new account starts with: the length of a visit and the opening hours, in minutes after midnight. */
  slotMinutes: number;
  openMinute: number;
  closeMinute: number;
}

const bookingWords: Record<string, BookingWords> = {
  clinic: {
    place: 'العيادة',
    toPlace: 'للعيادة',
    placeClosed: 'العيادة مقفولة',
    placeReminds: 'العيادة هتفكّرك',
    settingsSubtitle: 'بيانات العيادة ومواعيدها وأسعارها',
    client: 'المريض',
    client1: 'مريض',
    clients: 'المرضى',
    clients1: 'مرضى',
    pro: 'الدكتور',
    specialtyLabel: 'التخصص',
    done: 'تم الكشف',
    doneForClient: 'تم الكشف. بالشفا',
    firstService: 'كشف',
    notePlaceholder: 'حساسية، أدوية، تاريخ مرضي، أي حاجة تهم الدكتور...',
    closedExamples: 'عيد، سفر، مؤتمر',
    slotMinutes: 20,
    openMinute: 1020,
    closeMinute: 1320,
  },
  barber: {
    place: 'الصالون',
    toPlace: 'للصالون',
    placeClosed: 'الصالون مقفول',
    placeReminds: 'الصالون هيفكّرك',
    settingsSubtitle: 'بيانات الصالون ومواعيده وأسعاره',
    client: 'العميل',
    client1: 'عميل',
    clients: 'العملاء',
    clients1: 'عملاء',
    pro: 'الحلاق',
    specialtyLabel: 'نوع الصالون (رجالي، أطفال...)',
    done: 'خلص',
    doneForClient: 'خلصنا. نعيماً',
    firstService: 'حلاقة شعر',
    notePlaceholder: 'القصّة اللي بيحبها، درجة المكنة، أي حاجة تهم الحلاق...',
    closedExamples: 'عيد، سفر، إجازة',
    slotMinutes: 30,
    openMinute: 660,
    closeMinute: 1380,
  },
};

/** Words for products that take orders from a menu (the pages under /restaurant and /site/restaurant). */
export interface OrderingWords {
  /** The place, with "the": المطعم. */
  place: string;
  /** Where orders are made, with "the" and without: المطبخ / مطبخ. */
  kitchen: string;
  kitchen1: string;
  /** What the "kind of food" field asks for. */
  cuisineLabel: string;
  /** The menu section a new account starts with. */
  firstCategory: string;
}

const orderingWords: Record<string, OrderingWords> = {
  restaurant: {
    place: 'المطعم',
    kitchen: 'المطبخ',
    kitchen1: 'مطبخ',
    cuisineLabel: 'نوع الأكل',
    firstCategory: 'الأطباق الرئيسية',
  },
  cafe: {
    place: 'الكافيه',
    kitchen: 'البار',
    kitchen1: 'بار',
    cuisineLabel: 'نوع الكافيه (قهوة مختصة، عصاير...)',
    firstCategory: 'مشروبات سخنة',
  },
};

/** True for a product that runs on the booking system. */
export const takesBookings = (product: string | undefined): boolean => product !== undefined && product in bookingWords;

/** True for a product that runs on the ordering system. */
export const takesOrders = (product: string | undefined): boolean => product !== undefined && product in orderingWords;

/** The words of a booking product. A page asks before it knows the account exists, so an unknown one gets the clinic's. */
export const wordsForBooking = (product: string | undefined): BookingWords => bookingWords[product ?? ''] ?? bookingWords.clinic;

/** The words of an ordering product, with the restaurant's as the fallback. */
export const wordsForOrdering = (product: string | undefined): OrderingWords => orderingWords[product ?? ''] ?? orderingWords.restaurant;
