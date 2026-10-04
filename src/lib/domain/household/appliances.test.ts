import { describe, expect, it } from 'vitest';
import { applianceLabels, applianceValues, type Appliance } from './appliances';

describe('appliances', () => {
	it('defines at least one appliance for schema enums', () => {
		expect(applianceValues.length).toBeGreaterThan(0);
	});

	it('has a label for every appliance', () => {
		for (const appliance of applianceValues) {
			expect(applianceLabels[appliance]).toBeTruthy();
		}
	});

	it('does not define labels for unknown appliances', () => {
		expect(Object.keys(applianceLabels).toSorted()).toEqual([...applianceValues].toSorted());
	});
});

const _applianceTypeCheck: Appliance = applianceValues[0];
void _applianceTypeCheck;
