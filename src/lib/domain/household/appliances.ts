export const applianceValues = [
	'oven',
	'stovetop',
	'microwave',
	'air_fryer',
	'slow_cooker',
	'rice_cooker',
	'blender',
	'food_processor',
	'grill'
] as const;

export type Appliance = (typeof applianceValues)[number];

export const applianceLabels: Record<Appliance, string> = {
	oven: 'Oven',
	stovetop: 'Stovetop',
	microwave: 'Microwave',
	air_fryer: 'Air fryer',
	slow_cooker: 'Slow cooker',
	rice_cooker: 'Rice cooker',
	blender: 'Blender',
	food_processor: 'Food processor',
	grill: 'Grill'
};
