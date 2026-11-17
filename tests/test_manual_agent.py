import json
import unittest
from unittest.mock import patch

import manual_agent


class ManualAgentProgressTests(unittest.TestCase):
    milestones = [
        {'label': 'Otwarto profil', 'send': False},
        {'label': 'Uzupełniono wiadomość', 'send': False},
        {'label': 'Wysłano wiadomość', 'send': True},
    ]
    task = {'task': 'Otwórz profil, uzupełnij i wyślij wiadomość',
            'page': {'controls': []}, 'can_wait': True}

    def decide(self, *, item, milestones=None, completed=None):
        reply = {
            'action': 'wait', 'target': '', 'value': '', 'note': 'Czekam',
            'milestones': json.dumps(milestones) if milestones is not None else '',
            'completed_milestones': json.dumps(completed) if completed is not None else '',
        }
        with patch('manual_agent.ai_service.generate_json', return_value=reply) as generate:
            action = manual_agent.next_action({**self.task, **item})
        return action, generate

    def test_progress_is_from_confirmed_outcomes_and_plan_is_stable(self):
        first, _ = self.decide(item={'progress': None}, milestones=self.milestones, completed=[])
        self.assertEqual(first['progress'], {'milestones': self.milestones, 'completed': []})
        next_step, _ = self.decide(
            item={'progress': first['progress']},
            milestones=[{'label': 'Inny plan', 'send': False}], completed=[1, 1],
        )
        self.assertEqual(next_step['progress'], {'milestones': self.milestones, 'completed': [1]})

    def test_send_counts_only_after_a_live_attempt(self):
        plan = {'milestones': self.milestones, 'completed': [1, 2]}
        for dry_run, attempted, expected in (
            (True, True, [1, 2]), (False, False, [1, 2]), (False, True, [1, 2, 3]),
        ):
            with self.subTest(dry_run=dry_run, attempted=attempted):
                result, _ = self.decide(
                    item={'progress': plan, 'dry_run': dry_run, 'send_attempted': attempted},
                    completed=[1, 2, 3],
                )
                self.assertEqual(result['progress']['completed'], expected)

    def test_invalid_progress_keeps_previous_outcomes_without_retrying_action(self):
        plan = {'milestones': self.milestones, 'completed': [1]}
        result, generate = self.decide(item={'progress': plan}, completed=[99])
        self.assertEqual(result['progress'], plan)
        generate.assert_called_once()
        legacy, legacy_generate = self.decide(item={})
        self.assertNotIn('progress', legacy)
        self.assertEqual(legacy_generate.call_args.args[2], manual_agent.FIELDS)
