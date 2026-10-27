import unittest
from pathlib import Path
from unittest.mock import patch

import app
import test_app
import languages


class SenderTests(unittest.TestCase):
    setUp=test_app.SystemTests.setUp
    tearDown=test_app.SystemTests.tearDown

    def test_simulation_blocks_real_smtp_without_changing_queued_messages(self):
        app.prepare(1)
        with app.db() as c:c.execute("UPDATE campaigns SET status='active' WHERE id=1")
        languages.save_data_simulation(app.db,{'enabled':True})
        with patch('app.smtplib.SMTP') as smtp:
            app.send_one();smtp.assert_not_called()
        with app.db() as c:
            self.assertEqual(c.execute("SELECT COUNT(*) FROM messages WHERE status='queued'").fetchone()[0],2)
        languages.save_data_simulation(app.db,{'enabled':False})
        with patch('app.smtplib.SMTP') as smtp:
            app.send_one();smtp.return_value.__enter__.return_value.send_message.assert_called_once()

    def test_name_and_fallback_preserve_other_message_content(self):
        with patch.dict(app.os.environ,{'SMTP_SENDER_NAME':'Anna Kowalska'}):
            self.assertEqual(app.sender_placeholders('Hi Bernd,\nBest,\n[Your name]\n[ERP]'), 'Hi Bernd,\nBest,\nAnna Kowalska\n[ERP]')
            self.assertEqual(app.render('{{sender_name}} / {{sender_email}}',{},{}),'Anna Kowalska / sales@example.com')
        with patch.dict(app.os.environ,{'SMTP_SENDER_NAME':''}):
            self.assertEqual(app.sender_placeholders('[Your Name]'),'sales@example.com')
        with patch.dict(app.os.environ,{'SMTP_FROM':'Display Name <sales@example.com>'}):
            app.os.environ.pop('SMTP_SENDER_NAME',None)
            self.assertEqual(app.sender_placeholders('[Sender name]'),'Display Name')

    def test_no_mailbox_never_invents_identity(self):
        with patch.dict(app.os.environ,{'SMTP_FROM':'','SMTP_SENDER_NAME':''}):
            self.assertEqual(app.sender_placeholders('Text\n[Your name]'),'Text\n')

    def test_generation_passes_sender_and_replaces_ai_placeholder(self):
        with patch.dict(app.os.environ,{'SMTP_SENDER_NAME':'Anna Kowalska'}),patch('app.ai_service.ready',return_value=True),patch('app.ai_service.generate_json',return_value={'subject':'Hello','body':'Hi Bernd,\nBest,\n[Your name]'}) as generate:
            _,body=app.ai_copy({'name':'Bernd'},{'offer':'Services','language':'en'},{'subject':'Hello','body':'Hi'})
            self.assertIn('Anna Kowalska',body)
            self.assertEqual(generate.call_args.args[1]['sender'],{'name':'Anna Kowalska','email':'sales@example.com'})

    def test_settings_save_locally_and_reject_header_injection(self):
        with patch('app.ROOT',Path(self.temp.name)):
            app.save_sender({'name':' Anna Kowalska '})
            self.assertIn('SMTP_SENDER_NAME=Anna Kowalska',(Path(self.temp.name)/'.env').read_text(encoding='utf-8'))
            for value in ('Injected\nSMTP_FROM=bad@example.com','Bad\rName','Bad\x00Name','x'*151,123):
                with self.subTest(value=value),self.assertRaises(ValueError):app.save_sender({'name':value})

    def test_existing_queued_placeholder_is_corrected_at_delivery(self):
        with patch.dict(app.os.environ,{'SMTP_SENDER_NAME':'Anna Kowalska'}):
            app.prepare(1)
            with app.db() as c:
                c.execute("UPDATE campaigns SET status='active' WHERE id=1")
                c.execute("UPDATE messages SET body='Hi Bernd,\n[Your name]' WHERE position=0")
            with patch('app.smtplib.SMTP') as smtp:
                app.send_one()
                mail=smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
            self.assertIn('Anna Kowalska',mail.get_content())
            self.assertNotIn('[Your name]',mail.get_content())
            self.assertEqual(str(mail['From']),'Anna Kowalska <sales@example.com>')
            with app.db() as c:
                body=c.execute("SELECT body FROM messages WHERE position=0").fetchone()[0]
                self.assertIn('Anna Kowalska',body)
                self.assertNotIn('[Your name]',body)
