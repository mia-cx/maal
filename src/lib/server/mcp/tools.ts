import { householdTools } from './household-tools';
import { planningTools } from './planning-tools';
import { recipeTools } from './recipe-tools';
import type { ToolDefinition } from './registry';

export const tools: ToolDefinition[] = [...householdTools, ...recipeTools, ...planningTools];
