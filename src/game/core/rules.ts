import type { Action, AttackType } from './types';

/**
 * Fixed, visible rules of combat. They never change mid-challenge.
 *  slashL — the left half of the arena is cut → dash right.
 *  slashR — the right half is cut → dash left.
 *  crush  — the whole floor is hit → shield.
 *  pierce — a narrow central beam that breaks shields → dash to either side.
 */
export function isCorrect(attack: AttackType, action: Action): boolean {
  switch (attack) {
    case 'slashL':
      return action === 'dodgeR';
    case 'slashR':
      return action === 'dodgeL';
    case 'crush':
      return action === 'block';
    case 'pierce':
      return action === 'dodgeL' || action === 'dodgeR';
  }
}

/** Responses shown by in-context hints. */
export function hintActions(attack: AttackType): Action[] {
  switch (attack) {
    case 'slashL':
      return ['dodgeR'];
    case 'slashR':
      return ['dodgeL'];
    case 'crush':
      return ['block'];
    case 'pierce':
      return ['dodgeL', 'dodgeR'];
  }
}

export const ALL_ATTACKS: readonly AttackType[] = ['slashL', 'slashR', 'crush', 'pierce'];
