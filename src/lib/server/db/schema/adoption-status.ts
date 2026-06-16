export const adoptionStatusValues = ['pending_review', 'accepted', 'rejected'] as const;
export type AdoptionStatus = (typeof adoptionStatusValues)[number];
export const DEFAULT_ADOPTION_STATUS = 'pending_review' satisfies AdoptionStatus;
