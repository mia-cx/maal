import { householdTools } from './household-adapter';
import { planningTools } from './planning-adapter';
import { recipeTools } from './recipe-adapter';
import type { ToolDefinition } from './registry';

export const tools: ToolDefinition[] = [...householdTools, ...recipeTools, ...planningTools];
