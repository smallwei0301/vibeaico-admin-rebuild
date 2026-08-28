import type { TripBookingType } from '@/lib/types';

type GuideRequiredQuestion = {
  id: string;
  kind: 'TEXT' | 'CHOICE';
};

type GuideCheckoutField =
  | { key: 'contactName'; kind: 'TEXT'; required: true }
  | { key: 'contactMethod'; kind: 'CONTACT_METHOD'; required: true }
  | { key: 'partySize'; kind: 'PARTY_SIZE'; required: true }
  | { key: `question:${string}`; kind: 'TEXT' | 'CHOICE'; required: true };

const BASE_CHECKOUT_FIELDS: GuideCheckoutField[] = [
  { key: 'contactName', kind: 'TEXT', required: true },
  { key: 'contactMethod', kind: 'CONTACT_METHOD', required: true },
  { key: 'partySize', kind: 'PARTY_SIZE', required: true },
];

export function buildGuideCheckoutFields(
  requiredQuestions: GuideRequiredQuestion[],
): GuideCheckoutField[] {
  if (requiredQuestions.length > 2) throw new Error('GUIDE_REQUIRED_QUESTIONS_LIMIT');

  return [
    ...BASE_CHECKOUT_FIELDS,
    ...requiredQuestions.map((question) => ({
      key: `question:${question.id}` as const,
      kind: question.kind,
      required: true as const,
    })),
  ];
}

type FixedDepartureFacts = {
  departsOn: string;
  startTime: string;
  capacity: number;
  seatsBooked: number;
  minToDepart: number;
  qualifyingParticipants: number;
  formationDeadlineAt: string;
  salesStatus: 'OPEN' | 'CLOSED';
  formationStatus: 'COLLECTING' | 'FORMED' | 'REVIEW_REQUIRED';
};

type GuideSaleOption = {
  salesMode: TripBookingType;
  selector: 'departure' | 'availableSlot' | 'candidateSlot';
  action: 'reserve' | 'checkout' | 'apply';
  availability?: {
    departsOn: string;
    startTime: string;
    remainingSeats: number;
    minToDepart: number;
    qualifyingParticipants: number;
    remainingToForm: number;
    formationDeadlineAt: string;
    salesStatus: 'OPEN' | 'CLOSED';
    formationStatus: 'COLLECTING' | 'FORMED' | 'REVIEW_REQUIRED';
  };
};

export function buildGuideSaleOption(
  salesMode: 'SCHEDULED',
  facts: FixedDepartureFacts,
): GuideSaleOption;
export function buildGuideSaleOption(
  salesMode: 'INSTANT' | 'REQUEST',
): GuideSaleOption;
export function buildGuideSaleOption(
  salesMode: TripBookingType,
  facts?: FixedDepartureFacts,
): GuideSaleOption {
  if (salesMode === 'INSTANT') {
    return { salesMode, selector: 'availableSlot', action: 'checkout' };
  }
  if (salesMode === 'REQUEST') {
    return { salesMode, selector: 'candidateSlot', action: 'apply' };
  }

  const option: GuideSaleOption = { salesMode, selector: 'departure', action: 'reserve' };
  if (!facts) throw new Error('GUIDE_FIXED_DEPARTURE_FACTS_REQUIRED');
  if (
    facts.capacity < 0 || facts.seatsBooked < 0 || facts.seatsBooked > facts.capacity
    || facts.minToDepart < 0 || facts.qualifyingParticipants < 0
  ) throw new Error('GUIDE_FIXED_DEPARTURE_FACTS_INVALID');

  return {
    ...option,
    availability: {
      departsOn: facts.departsOn,
      startTime: facts.startTime,
      remainingSeats: Math.max(0, facts.capacity - facts.seatsBooked),
      minToDepart: facts.minToDepart,
      qualifyingParticipants: facts.qualifyingParticipants,
      remainingToForm: Math.max(0, facts.minToDepart - facts.qualifyingParticipants),
      formationDeadlineAt: facts.formationDeadlineAt,
      salesStatus: facts.salesStatus,
      formationStatus: facts.formationStatus,
    },
  };
}

type GuideCompletionFacts = {
  salesMode: TripBookingType;
  requestStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'SLOT_TAKEN' | null;
  paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
  formationStatus: 'COLLECTING' | 'FORMED' | null;
  totalAmount: number;
  paidAmount: number;
  paymentDueAt: string | null;
  referenceNo: string;
  formationProgress: {
    minToDepart: number;
    qualifyingParticipants: number;
    latestNotificationAt: string;
  } | null;
  meetingInfoAvailableAt: string;
  orderUrl: string;
  guideContactUrl: string;
};

type GuideCompletionView = {
  state:
    | 'REQUEST_PENDING'
    | 'REQUEST_REJECTED'
    | 'REQUEST_SLOT_TAKEN'
    | 'WAITING_PAYMENT'
    | 'DEPOSIT_PAID_COLLECTING'
    | 'FORMED_BALANCE_DUE'
    | 'PAID_COLLECTING'
    | 'PAID_IN_FULL';
  headline:
    | 'requestPending'
    | 'requestRejected'
    | 'requestSlotTaken'
    | 'waitingPayment'
    | 'depositPaidCollecting'
    | 'formedBalanceDue'
    | 'paidCollecting'
    | 'paidInFull';
  nextAction: 'waitForGuide' | 'chooseAnotherSlot' | 'pay' | 'waitForFormation' | 'payBalance' | 'viewOrder';
  paidAmount: number;
  balanceDue: number;
  paymentDueAt: string | null;
  referenceNo: string;
  formationProgress: {
    minToDepart: number;
    qualifyingParticipants: number;
    remainingToForm: number;
    latestNotificationAt: string;
  } | null;
  meetingInfoAvailableAt: string;
  orderUrl: string;
  guideContactUrl: string;
};

export function buildGuideCompletionView(facts: GuideCompletionFacts): GuideCompletionView {
  if (
    facts.totalAmount < 0 || facts.paidAmount < 0 || facts.paidAmount > facts.totalAmount
  ) throw new Error('GUIDE_PAYMENT_FACTS_INVALID');
  if (
    facts.formationProgress
    && (
      facts.formationProgress.minToDepart < 0
      || facts.formationProgress.qualifyingParticipants < 0
      || facts.formationProgress.qualifyingParticipants > facts.formationProgress.minToDepart
    )
  ) throw new Error('GUIDE_FORMATION_FACTS_INVALID');
  const formationProgress = facts.formationProgress && {
    ...facts.formationProgress,
    remainingToForm:
      facts.formationProgress.minToDepart - facts.formationProgress.qualifyingParticipants,
  };
  const money = {
    paidAmount: facts.paidAmount,
    balanceDue: facts.totalAmount - facts.paidAmount,
    paymentDueAt: facts.paymentDueAt,
    referenceNo: facts.referenceNo,
    formationProgress,
    meetingInfoAvailableAt: facts.meetingInfoAvailableAt,
    orderUrl: facts.orderUrl,
    guideContactUrl: facts.guideContactUrl,
  };

  if (facts.salesMode === 'REQUEST' && facts.requestStatus !== 'ACCEPTED') {
    if (facts.requestStatus === 'REJECTED') {
      return { state: 'REQUEST_REJECTED', headline: 'requestRejected', nextAction: 'chooseAnotherSlot', ...money };
    }
    if (facts.requestStatus === 'SLOT_TAKEN') {
      return { state: 'REQUEST_SLOT_TAKEN', headline: 'requestSlotTaken', nextAction: 'chooseAnotherSlot', ...money };
    }
    return { state: 'REQUEST_PENDING', headline: 'requestPending', nextAction: 'waitForGuide', ...money };
  }

  if (facts.paymentStatus === 'UNPAID') {
    return { state: 'WAITING_PAYMENT', headline: 'waitingPayment', nextAction: 'pay', ...money };
  }
  if (facts.paymentStatus === 'PARTIAL' && facts.formationStatus === 'FORMED') {
    return { state: 'FORMED_BALANCE_DUE', headline: 'formedBalanceDue', nextAction: 'payBalance', ...money };
  }
  if (facts.paymentStatus === 'PARTIAL') {
    return { state: 'DEPOSIT_PAID_COLLECTING', headline: 'depositPaidCollecting', nextAction: 'waitForFormation', ...money };
  }
  if (facts.formationStatus === 'COLLECTING') {
    return { state: 'PAID_COLLECTING', headline: 'paidCollecting', nextAction: 'waitForFormation', ...money };
  }
  return { state: 'PAID_IN_FULL', headline: 'paidInFull', nextAction: 'viewOrder', ...money };
}
