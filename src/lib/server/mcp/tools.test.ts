import { describe, expect, it } from 'vitest';
import { tools } from './tools';

describe('MCP tools', () => {
	it('keeps the public tool order stable', () => {
		expect(tools.map((tool) => tool.name)).toEqual([
			'list_user_households',
			'list_user_recipes',
			'get_user_recipe',
			'create_user_recipe',
			'update_user_recipe',
			'delete_user_recipe',
			'list_household_plan',
			'create_household_meal',
			'create_household_meals',
			'get_household_meal',
			'update_household_meal',
			'delete_household_meal',
			'create_meal_check_in'
		]);
	});
});
