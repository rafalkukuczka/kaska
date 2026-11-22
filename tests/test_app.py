import io
import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


class SystemTests(unittest.TestCase):
    def test_blocking_cancels_queue_and_unblocking_restores_previous_status(self):
        app.prepare(1)
        with app.db() as c:
            app.change_contact_status(c,1,'blocked')
            app.change_contact_status(c,1,'blocked')
            self.assertEqual(c.execute('SELECT status FROM contacts WHERE id=1').fetchone()[0],'blocked')
            self.assertEqual({row[0] for row in c.execute('SELECT status FROM messages')},{'cancelled'})
            with self.assertRaises(ValueError):app.change_contact_status(c,1,'active')
            app.change_contact_status(c,1,'unblock')
            self.assertEqual(c.execute('SELECT status FROM contacts WHERE id=1').fetchone()[0],'active')
            self.assertEqual({row[0] for row in c.execute('SELECT status FROM messages')},{'cancelled'})
            app.change_contact_status(c,1,'paused')
            app.change_contact_status(c,1,'blocked')
            app.change_contact_status(c,1,'unblock')
            self.assertEqual(c.execute('SELECT status FROM contacts WHERE id=1').fetchone()[0],'paused')
            app.change_contact_status(c,1,'unsubscribed')
            with self.assertRaises(ValueError):app.change_contact_status(c,1,'unblock')

    def test_reply_sync_cannot_block_outbound_worker(self):
        app.STOP_WORKERS.clear()
        with patch('app.threading.Thread') as thread,patch('app.send_one') as send,patch('app.STOP_WORKERS.wait',side_effect=StopIteration):
            with self.assertRaises(StopIteration):app.worker()
            thread.assert_called_once_with(target=app.reply_worker,name='mail-replies')
            thread.return_value.start.assert_called_once()
            send.assert_called_once()

    def test_reply_worker_retries_after_failure(self):
        app.STOP_WORKERS.clear()
        with patch.dict(app.os.environ,{'IMAP_HOST':'imap.test'}),patch('app.sync_replies',side_effect=TimeoutError),patch('app.event') as log,patch('app.STOP_WORKERS.wait',side_effect=StopIteration):
            with self.assertRaises(StopIteration):app.reply_worker()
            self.assertIn('IMAP',log.call_args.args[0])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_db = app.DB
        app.DB = Path(self.temp.name) / 'test.sqlite3'
        app.init()
        self.env = patch.dict(app.os.environ, {'SMTP_HOST': 'smtp.test', 'SMTP_FROM': 'sales@example.com', 'SMTP_USER': '', 'SMTP_SECURITY': 'starttls', 'DAILY_SEND_LIMIT': '50', 'SEND_INTERVAL_SECONDS': '0', 'OPENAI_API_KEY': '', 'HUNTER_API_KEY': ''})
        self.env.start()
        self.apollo_env = patch.dict(app.os.environ, {'APOLLO_API_KEY': ''})
        self.apollo_env.start()
        with app.db() as c:
            app.add_contact(c, {'name': 'Anna', 'email': 'anna@example.com', 'company': 'Acme'})
            c.execute("INSERT INTO campaigns(id,name,offer,audience,created) VALUES(1,'Test','Oferta','IT',?)", (time.time(),))
            c.execute("INSERT INTO steps(campaign_id,position,delay_days,subject,body) VALUES(1,0,0,'Dla {{company}}','Cześć {{name}}, {{offer}}')")
            c.execute("INSERT INTO steps(campaign_id,position,delay_days,subject,body) VALUES(1,1,3,'Powrót','Czy aktualne?')")

    def tearDown(self):
        self.apollo_env.stop()
        self.env.stop()
        app.DB = self.old_db
        self.temp.cleanup()

    def activate(self):
        app.prepare(1)
        with app.db() as c:
            c.execute("UPDATE campaigns SET status='active'")

    def test_campaign_preparation_counts_drafts_and_clears_finished_jobs(self):
        progress = []

        def draft(*_):
            job, = app.campaign_preparation_jobs()
            progress.append((job['completed'], job['total']))
            return 'Subject', 'Body'

        with patch('app.ai_copy', side_effect=draft):
            app.prepare(1)
        self.assertEqual(progress, [(0, 2), (1, 2)])
        self.assertEqual(app.campaign_preparation_jobs(), [])

        with patch('app.ai_copy', side_effect=ValueError('Draft failed')):
            with self.assertRaisesRegex(ValueError, 'Draft failed'):
                app.prepare(1)
        self.assertEqual(app.campaign_preparation_jobs(), [])

    def test_campaign_preparation_can_stop_without_replacing_existing_messages(self):
        app.prepare(1)
        with app.db() as c:
            before = [dict(row) for row in c.execute('SELECT * FROM messages ORDER BY id')]

        def stop_during_first_draft(*_):
            job, = app.campaign_preparation_jobs()
            self.assertTrue(app.cancel_campaign_preparation(job['id']))
            self.assertEqual(app.campaign_preparation_jobs()[0]['status'], 'cancelling')
            return 'Uncommitted subject', 'Uncommitted body'

        with patch('app.ai_copy', side_effect=stop_during_first_draft) as copy:
            with self.assertRaises(app.CampaignPreparationCancelled):
                app.prepare(1)
            copy.assert_called_once()
        with app.db() as c:
            self.assertEqual([dict(row) for row in c.execute('SELECT * FROM messages ORDER BY id')], before)
        self.assertEqual(app.campaign_preparation_jobs(), [])

    def test_contact_paste_extracts_only_supplied_values_and_skips_ai_in_simulation(self):
        text = 'Kontakt: Anna Nowak\nul. Poranna 90A\n41-103 Siemianowice Śląskie\nNIP 6342721154\nTel. 609 02 57 57\nMail: anna@example.com\nStrona: company.example'
        with patch('app.ai_service.ready', return_value=True), patch('app.ai_service.generate_json') as ai:
            local = app.parse_contact({'text':text}, simulated=True)
            ai.assert_not_called()
            ai.return_value = {'email':'anna@example.com', 'name':'Anna Nowak', 'phone':'555 000 000', 'website':'company.example'}
            extracted = app.parse_contact({'text':text})
            self.assertIn('address', ai.call_args.kwargs['optional_fields'])
            ai.side_effect = ValueError('OpenAI unavailable')
            self.assertEqual(app.parse_contact({'text':text}), local)
        self.assertEqual(local['fields']['phone'], '609 02 57 57')
        self.assertEqual(local['fields']['address'], 'ul. Poranna 90A\n41-103 Siemianowice Śląskie')
        self.assertEqual(local['fields']['notes'], 'NIP 6342721154')
        self.assertEqual(extracted, {**local,'used_ai':True})

    def test_contact_paste_accepts_international_signatures_and_formatted_addresses(self):
        cases = [
            ('Full name: Alex Smith\n350 5th Avenue\nNew York, NY 10118\nPhone +1 212 555 0142\nalex@example.net',
             '350 5th Avenue\nNew York, NY 10118', '+1 212 555 0142'),
            ('Name: Léa Moreau\nAdresse : 10 rue de Rivoli\n75004 Paris\nTél. +33 1 23 45 67 89\nlea@example.net',
             '10 rue de Rivoli\n75004 Paris', '+33 1 23 45 67 89'),
            ('Name: Max Weber\nFriedrichstraße 20\n10117 Berlin\nTelefon: +49 30 12345678\nmax@example.net',
             'Friedrichstraße 20\n10117 Berlin', '+49 30 12345678'),
        ]
        for text, address, phone in cases:
            fields = app.parse_contact({'text':text}, simulated=True)['fields']
            self.assertEqual((fields['address'],fields['phone']), (address,phone))
        text = 'Address\n2-8-1 Nishi-Shinjuku\nTokyo 163-8001'
        with patch('app.ai_service.ready', return_value=True), patch('app.ai_service.generate_json',
                return_value={'address':'2-8-1 Nishi-Shinjuku, Tokyo 163-8001'}):
            self.assertEqual(app.parse_contact({'text':text})['fields']['address'],
                             '2-8-1 Nishi-Shinjuku, Tokyo 163-8001')

    def test_contact_image_returns_reviewable_fields_and_requires_live_vision(self):
        image = 'data:image/jpeg;base64,/9j/4P/Z'
        transcript = '350 5th Avenue\nNew York, NY 10118\nEmail: sales@example.net'
        with patch('app.ai_service.ready', return_value=True), patch('app.ai_service.generate_json') as ai:
            with self.assertRaisesRegex(ValueError, 'trybie symulacji'):
                app.parse_contact({'image':image}, simulated=True)
            with self.assertRaisesRegex(ValueError, 'obrazu'):
                app.parse_contact({'image':'data:image/jpeg;base64,YWJj'})
            ai.assert_not_called()
            ai.return_value = {'transcript':transcript, 'email':'wrong@example.net'}
            result = app.parse_contact({'image':image})
            self.assertEqual(ai.call_args.kwargs['image_url'], image)
        self.assertEqual(result['transcript'], transcript)
        self.assertEqual(result['fields']['email'], 'sales@example.net')
        self.assertEqual(result['fields']['address'], '350 5th Avenue\nNew York, NY 10118')

    def test_personalization_deduplication_and_persistence(self):
        with app.db() as c:
            app.add_contact(c, {'email': 'ANNA@example.com'})
        app.prepare(1)
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM contacts').fetchone()[0], 1)
            row = c.execute('SELECT * FROM messages WHERE position=0').fetchone()
            self.assertEqual(row['subject'], 'Dla Acme')
            self.assertEqual(row['body'], 'Cześć Anna, Oferta')
        app.init()
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 2)

    def test_draft_does_not_send(self):
        app.prepare(1)
        with patch('app.smtplib.SMTP') as smtp:
            app.send_one()
            smtp.assert_not_called()

    def test_delete_campaign_cancels_pending_but_retains_delivery_history_and_contacts(self):
        app.prepare(1)
        with app.db() as c:
            c.execute("UPDATE campaigns SET status='active' WHERE id=1")
            c.execute("UPDATE messages SET status='sent',sent_at=?,message_id='<sent@example.com>' WHERE position=0", (time.time(),))
        app.delete_campaign(1)
        with app.db() as c:
            self.assertEqual(c.execute('SELECT status FROM campaigns WHERE id=1').fetchone()[0], 'deleted')
            self.assertEqual(c.execute('SELECT status FROM messages WHERE position=1').fetchone()[0], 'cancelled')
            self.assertEqual(c.execute('SELECT message_id FROM messages WHERE position=0').fetchone()[0], '<sent@example.com>')
            self.assertEqual(c.execute('SELECT COUNT(*) FROM steps').fetchone()[0], 0)
            self.assertEqual(c.execute('SELECT status FROM contacts').fetchone()[0], 'active')
            self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(), [])
        with patch('app.smtplib.SMTP') as smtp:
            app.send_one()
            smtp.assert_not_called()
        with self.assertRaises(ValueError):
            app.prepare(1)
        with self.assertRaises(ValueError):
            app.delete_campaign(1)

    def test_deletion_during_preparation_does_not_restore_messages(self):
        def copy(*args):
            with app.db() as c:
                deleted = c.execute('SELECT status FROM campaigns WHERE id=1').fetchone()[0] == 'deleted'
            if not deleted:
                app.delete_campaign(1)
            return 'Subject', 'Body'
        with patch('app.ai_copy', side_effect=copy), self.assertRaises(ValueError):
            app.prepare(1)
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 0)

    def test_delete_does_not_wait_for_mail_lock(self):
        errors = []
        def remove():
            try:
                app.delete_campaign(1)
            except Exception as exc:
                errors.append(exc)
        thread = threading.Thread(target=remove, daemon=True)
        try:
            with app.MAIL_LOCK:
                thread.start()
                thread.join(2)
                completed_while_mail_was_busy = not thread.is_alive()
        finally:
            thread.join(3)
        self.assertTrue(completed_while_mail_was_busy)
        self.assertEqual(errors, [])

    def test_imap_network_wait_does_not_hold_mail_lock(self):
        entered, release = threading.Event(), threading.Event()
        errors = []
        def login(*args):
            entered.set()
            if not release.wait(5):
                raise TimeoutError('Test did not release IMAP')
        def sync():
            try:
                app.sync_replies()
            except Exception as exc:
                errors.append(exc)
        with patch.dict(app.os.environ, {'IMAP_HOST': 'imap.test'}), patch('app.imaplib.IMAP4_SSL') as imap:
            mailbox = imap.return_value.__enter__.return_value
            mailbox.login.side_effect = login
            mailbox.uid.return_value = ('OK', [b''])
            mailbox.response.return_value = ('UIDVALIDITY', [b'1'])
            thread = threading.Thread(target=sync, daemon=True)
            thread.start()
            try:
                self.assertTrue(entered.wait(2))
                acquired = app.MAIL_LOCK.acquire(timeout=.1)
                if acquired:
                    app.MAIL_LOCK.release()
                self.assertTrue(acquired, 'IMAP held the application lock during network I/O')
                app.delete_campaign(1)
            finally:
                release.set()
                thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])

    def check_delete_during_smtp(self, fail):
        self.activate()
        entered, release = threading.Event(), threading.Event()
        errors = []
        def deliver(*args):
            entered.set()
            if not release.wait(5):
                raise TimeoutError('Test did not release SMTP')
            if fail:
                raise OSError('SMTP failed')
        def send():
            try:
                app.send_one()
            except Exception as exc:
                errors.append(exc)
        def remove():
            try:
                app.delete_campaign(1)
            except Exception as exc:
                errors.append(exc)
        with patch('app.smtplib.SMTP') as smtp:
            smtp.return_value.__enter__.return_value.send_message.side_effect = deliver
            sender = threading.Thread(target=send, daemon=True)
            remover = threading.Thread(target=remove, daemon=True)
            sender.start()
            try:
                self.assertTrue(entered.wait(2))
                remover.start()
                remover.join(2)
                self.assertFalse(remover.is_alive(), 'Deletion waited for SMTP network I/O')
            finally:
                release.set()
                sender.join(3)
                if remover.ident:
                    remover.join(3)
        self.assertFalse(sender.is_alive())
        self.assertEqual(errors, [])
        with app.db() as c:
            self.assertEqual(c.execute('SELECT status FROM campaigns WHERE id=1').fetchone()[0], 'deleted')
            self.assertEqual(c.execute('SELECT status FROM messages WHERE position=0').fetchone()[0], 'uncertain' if fail else 'sent')
            self.assertEqual(c.execute('SELECT status FROM messages WHERE position=1').fetchone()[0], 'cancelled')

    def test_delete_finishes_during_smtp_delivery(self):
        self.check_delete_during_smtp(fail=False)

    def test_smtp_failure_does_not_resurrect_deleted_campaign(self):
        self.check_delete_during_smtp(fail=True)

    def test_send_and_delayed_followup(self):
        self.activate()
        with patch('app.smtplib.SMTP') as smtp:
            app.send_one()
            mail = smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
            self.assertEqual(mail['To'], 'anna@example.com')
            self.assertIn('/unsubscribe?', mail.get_content())
            app.send_one()
            self.assertEqual(smtp.return_value.__enter__.return_value.send_message.call_count, 1)
        with app.db() as c:
            self.assertEqual(c.execute("SELECT COUNT(*) FROM messages WHERE status='sent'").fetchone()[0], 1)

    def test_followup_waits_after_delayed_first_send(self):
        self.activate()
        with app.db() as c:
            c.execute('UPDATE messages SET due=0')
        with patch('app.smtplib.SMTP') as smtp:
            app.send_one()
            app.send_one()
            self.assertEqual(smtp.return_value.__enter__.return_value.send_message.call_count, 1)

    def test_daily_limit_and_paused_contact(self):
        self.activate()
        with patch.dict(app.os.environ, {'DAILY_SEND_LIMIT': '0'}), patch('app.smtplib.SMTP') as smtp:
            app.send_one()
            smtp.assert_not_called()

    def test_waiting_followup_does_not_block_other_recipients(self):
        self.activate()
        with patch('app.smtplib.SMTP'):
            app.send_one()
        with app.db() as c:
            c.execute('UPDATE messages SET due=0')
            app.add_contact(c, {'email': 'second@example.com'})
            c.execute("INSERT INTO messages(campaign_id,contact_id,position,subject,body,due) VALUES(1,2,0,'Hello','Body',1)")
        with patch('app.smtplib.SMTP') as smtp:
            app.send_one()
            self.assertEqual(smtp.return_value.__enter__.return_value.send_message.call_args.args[0]['To'], 'second@example.com')
        with app.db() as c:
            c.execute("UPDATE contacts SET status='paused'")
        with patch('app.smtplib.SMTP') as smtp:
            app.send_one()
            smtp.assert_not_called()

    def test_smtp_error_is_not_retried(self):
        self.activate()
        with patch('app.smtplib.SMTP', side_effect=OSError('disconnect')) as smtp:
            app.send_one()
            app.send_one()
            self.assertEqual(smtp.call_count, 1)
        with app.db() as c:
            self.assertEqual(c.execute('SELECT status FROM messages WHERE position=0').fetchone()[0], 'uncertain')

    def test_ai_failure_keeps_old_drafts(self):
        app.prepare(1)
        with patch('app.ai_copy', side_effect=ValueError('model unavailable')):
            with self.assertRaises(ValueError):
                app.prepare(1)
        with app.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 2)

    def test_restart_marks_inflight_as_uncertain(self):
        app.prepare(1)
        with app.db() as c:
            c.execute("UPDATE messages SET status='sending' WHERE position=0")
        app.init()
        with app.db() as c:
            self.assertEqual(c.execute('SELECT status FROM messages WHERE position=0').fetchone()[0], 'uncertain')

    def test_gmail_checks_both_protocols_before_saving(self):
        with patch('app.ROOT', Path(self.temp.name)), patch('app.smtplib.SMTP') as smtp, patch('app.imaplib.IMAP4_SSL') as imap:
            app.connect_gmail({'email': 'me@example.com', 'password': 'abcd efgh ijkl mnop'})
            smtp.return_value.__enter__.return_value.login.assert_called_once_with('me@example.com', 'abcdefghijklmnop')
            imap.return_value.__enter__.return_value.login.assert_called_once_with('me@example.com', 'abcdefghijklmnop')
            smtp.return_value.__enter__.return_value.send_message.assert_not_called()
            self.assertIn('SMTP_HOST=smtp.gmail.com', (Path(self.temp.name)/'.env').read_text())

    def test_gmail_does_not_save_when_login_fails(self):
        with patch('app.ROOT', Path(self.temp.name)), patch('app.smtplib.SMTP', side_effect=OSError('unavailable')):
            with self.assertRaises(OSError):
                app.connect_gmail({'email': 'me@example.com', 'password': 'abcdefghijklmnop'})
            self.assertFalse((Path(self.temp.name)/'.env').exists())

    def test_research_rejects_private_hosts_and_unsafe_urls(self):
        with self.assertRaises(ValueError):
            app.research_website('http://example.com')
        with patch('website_research.socket.getaddrinfo', return_value=[(2,1,6,'',('127.0.0.1',443))]):
            with self.assertRaises(ValueError):
                app.research_website('https://internal.test')

    def test_research_extracts_company_context_without_ai(self):
        with patch('website_research.socket.getaddrinfo', return_value=[(2,1,6,'',('93.184.216.34',443))]), patch('website_research.socket.create_connection'), patch('website_research.ssl.create_default_context'), patch('website_research.http.client.HTTPSConnection') as connection:
            response = connection.return_value.getresponse.return_value
            response.status = 200
            response.getheader.return_value = 'text/html'
            response.read.return_value = ('<meta name="description" content="Usługi dla firm"><h1>Firma testowa</h1><p>'+('Wdrażamy oprogramowanie dla klientów biznesowych. '*5)+'</p><script>IGNORE THIS</script>').encode()
            result = app.research_website('https://example.com')
            self.assertEqual(result['offer'], 'Usługi dla firm')
            self.assertFalse(result['ai'])

    def test_research_ai_uses_requested_message_language(self):
        with patch.dict(app.os.environ, {'OPENAI_API_KEY': 'fixture'}), patch('website_research.socket.getaddrinfo', return_value=[(2,1,6,'',('93.184.216.34',443))]), patch('website_research.socket.create_connection'), patch('website_research.ssl.create_default_context'), patch('website_research.http.client.HTTPSConnection') as connection, patch('app.ai_service.generate_json', return_value={'offer': 'Dienstleistungen für Unternehmen', 'audience': 'Unternehmen'}) as generate:
            response = connection.return_value.getresponse.return_value
            response.status = 200
            response.getheader.return_value = 'text/html'
            response.read.return_value = ('<main>'+('Services for business clients. '*6)+'</main>').encode()
            result = app.research_website('https://example.com', 'de')
            self.assertIn('niemiecku', generate.call_args.args[0])
            self.assertEqual(result['offer'], 'Dienstleistungen für Unternehmen')
            self.assertEqual(result['source'], 'https://example.com')
            self.assertTrue(result['ai'])

    def test_imap_reply_stops_followups_and_is_idempotent(self):
        self.activate()
        with patch('app.smtplib.SMTP'):
            app.send_one()
        with app.db() as c:
            message_id = c.execute('SELECT message_id FROM messages WHERE position=0').fetchone()[0]
        raw = f'From: anna@example.com\r\nSubject: Re: Oferta\r\nIn-Reply-To: {message_id}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nSTOP'.encode()
        with patch.dict(app.os.environ, {'IMAP_HOST': 'imap.test'}), patch('app.imaplib.IMAP4_SSL') as imap:
            mailbox = imap.return_value.__enter__.return_value
            mailbox.response.return_value = ('UIDVALIDITY', [b'1'])
            mailbox.uid.side_effect = lambda command, *args: ('OK', [b'1']) if command == 'search' else ('OK', [(b'1', raw)])
            app.sync_replies()
            app.sync_replies()
        with app.db() as c:
            self.assertEqual(c.execute('SELECT status FROM contacts').fetchone()[0], 'replied')
            self.assertEqual(c.execute('SELECT COUNT(*) FROM replies').fetchone()[0], 1)
            self.assertEqual(c.execute('SELECT campaign_id FROM replies').fetchone()[0],1)
            self.assertEqual(c.execute('SELECT status FROM messages WHERE position=1').fetchone()[0], 'cancelled')

    def test_headless_contact_research_pins_public_hosts(self):
        browser = app.headless_browser
        def resolve(host, *_args, **_kwargs):
            address = '127.0.0.1' if host.startswith('www.') else '93.184.216.34'
            return [(None, None, None, None, (address, 443))]
        with (patch('manual_headless.socket.getaddrinfo', side_effect=resolve),
              patch.object(browser, 'request', return_value={'pages': []}) as dispatch):
            self.assertEqual(browser.contacts('firm.example/kontakt', 'reader'), {'pages': []})
            dispatch.assert_called_once_with({'method': 'contact-research', 'args': {
                'url': 'https://firm.example/kontakt', 'hosts': {'firm.example': '93.184.216.34'},
                'source': 'reader'}}, contacts=True)
            with self.assertRaisesRegex(ValueError, 'publiczną'):
                browser.contacts('https://www.firm.example/kontakt', 'reader')

    def test_capture_contact_reuses_existing_contact_and_preserves_opt_out(self):
        with app.db() as c:
            project = app.project_scope.active(c)
            item = {'confirmed': True, 'project_id': project, 'name': 'Alex Nowak', 'email': 'alex@example.com',
                    'company': 'Example', 'role': 'Director', 'tag': 'Ze strony',
                    'source': 'https://example.com/team?session=secret#alex'}
            with self.assertRaises(ValueError):
                app.capture_contact(c, {**item, 'confirmed': False})
            with self.assertRaises(ValueError):
                app.capture_contact(c, {**item, 'project_id': project + 1})
            self.assertEqual(c.execute('SELECT COUNT(*) FROM contacts').fetchone()[0], 1)
            first = app.capture_contact(c, item)
            c.execute("UPDATE contacts SET status='unsubscribed' WHERE id=?", (first['id'],))
            duplicate = app.capture_contact(c, {**item, 'email': 'ALEX@EXAMPLE.COM', 'name': 'Other',
                                               'phone': '+49 (0)2203 / 297 11 10',
                                               'tag': 'Nowy', 'source': 'https://example.com/directory'})
            app.capture_contact(c, {**item, 'phone': '+48 123 456 789'})
            self.assertFalse(first['existing'])
            self.assertEqual(duplicate, {'id': first['id'], 'existing': True})
            contact = c.execute('SELECT * FROM contacts WHERE id=?', (first['id'],)).fetchone()
            self.assertEqual((contact['status'], contact['name'], contact['company'], contact['role']),
                             ('unsubscribed', 'Alex Nowak', 'Example', 'Director'))
            self.assertEqual(json.loads(contact['tags']), ['Ze strony', 'Nowy'])
            self.assertEqual(json.loads(contact['research_data'])['work_phone'], '+49 (0)2203 / 297 11 10')
            self.assertEqual([source['url'] for source in json.loads(contact['research_data'])['sources']],
                             ['https://example.com/team', 'https://example.com/directory'])
            with self.assertRaises(ValueError):
                app.update_contact_phone(c, {'id': first['id'], 'phone': 'invalid'})
            app.update_contact_phone(c, {'id': first['id'], 'phone': ''})
            research = json.loads(c.execute('SELECT research_data FROM contacts WHERE id=?', (first['id'],)).fetchone()[0])
            self.assertNotIn('work_phone', research)
            self.assertEqual(len(research['sources']), 2)

    def test_contact_edit_rejects_duplicates_and_keeps_relationships(self):
        with app.db() as c:
            app.add_contact(c, {'email': 'existing@example.com'})
            c.execute("UPDATE contacts SET status='unsubscribed' WHERE id=1")
            edit = {'id': 1, 'email': 'EXISTING@EXAMPLE.COM', 'name': 'Anna Edytowana', 'phone': '+48 123 456 789',
                    'company': 'Acme Polska', 'role': 'Dyrektor', 'notes': 'Nowe dane', 'tags': 'Kwalifikacja'}
            with self.assertRaisesRegex(ValueError, 'już istnieje'):
                app.update_contact(c, edit)
            self.assertEqual(c.execute('SELECT email FROM contacts WHERE id=1').fetchone()[0], 'anna@example.com')
            app.update_contact(c, {**edit, 'email': 'NOWA@EXAMPLE.COM'})
            row = c.execute('SELECT * FROM contacts WHERE id=1').fetchone()
            self.assertEqual((row['email'], row['name'], row['status']), ('nowa@example.com', 'Anna Edytowana', 'unsubscribed'))
            self.assertEqual(json.loads(row['tags']), ['Kwalifikacja'])
            self.assertEqual(json.loads(row['research_data'])['work_phone'], '+48 123 456 789')
        with patch('prospecting.Hunter.request') as lookup:
            self.assertTrue(app.hunter_contact('nowa@example.com', simulated=True)['phone'])
            lookup.assert_not_called()

    def test_http_import_csrf_edit_and_unsubscribe(self):
        server = app.ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        old_port = app.PORT
        app.PORT = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{app.PORT}'
        def post(path, data, token=True, form=False):
            raw = data.encode() if form else json.dumps(data).encode()
            headers = {'Content-Type': 'application/x-www-form-urlencoded' if form else 'application/json'}
            if token:
                headers['X-CSRF-Token'] = app.CSRF
            return urllib.request.urlopen(urllib.request.Request(base+path, raw, headers))
        try:
            with patch.dict('os.environ', {'OPENAI_API_KEY': 'sk-private-test', 'HUNTER_API_KEY': 'hunter-private-test'}), urllib.request.urlopen(base+'/api/state') as res:
                payload = res.read().decode()
                self.assertEqual(json.loads(payload)['totals']['contacts'], 1)
                self.assertTrue(json.loads(payload)['integrations']['ai'])
                self.assertEqual(json.loads(payload)['integrations']['ai_provider'], 'openai')
                self.assertNotIn('sk-private-test', payload)
                self.assertTrue(json.loads(payload)['prospecting']['hunter'])
                self.assertNotIn('hunter-private-test', payload)
            with self.assertRaises(urllib.error.HTTPError) as err:
                post('/api/contacts', {'email':'x@example.com'}, token=False)
            self.assertEqual(err.exception.code, 403)
            with self.assertRaises(urllib.error.HTTPError):
                post('/api/import', {'csv':'email\nvalid@example.com\nbad'})
            with app.db() as c:
                self.assertEqual(c.execute('SELECT COUNT(*) FROM contacts').fetchone()[0], 1)
            post('/api/campaigns', {'name':'API campaign','offer':'Offer','audience':'IT','steps':[{'delay_days':0,'subject':'Hello','body':'Test'}]}).close()
            with app.db() as c:
                self.assertEqual(c.execute('SELECT COUNT(*) FROM campaigns').fetchone()[0], 2)
                self.assertEqual(c.execute('SELECT COUNT(*) FROM steps WHERE campaign_id=2').fetchone()[0], 1)
            app.prepare(1)
            post('/api/message', {'id':1,'subject':'Nowy temat','body':'Nowa treść'}).close()
            with app.db() as c:
                self.assertEqual(c.execute('SELECT subject FROM messages WHERE id=1').fetchone()[0], 'Nowy temat')
            url = base+'/unsubscribe?id=1&token='+app.sign(1)
            urllib.request.urlopen(url).close()
            with app.db() as c:
                self.assertEqual(c.execute('SELECT status FROM contacts').fetchone()[0], 'active')
            post('/unsubscribe', 'id=1&token='+app.sign(1), token=False, form=True).close()
            with app.db() as c:
                self.assertEqual(c.execute('SELECT status FROM contacts').fetchone()[0], 'unsubscribed')
                self.assertEqual(c.execute("SELECT COUNT(*) FROM messages WHERE status='queued'").fetchone()[0], 0)
            with self.assertRaises(urllib.error.HTTPError) as err:
                post('/api/campaign/delete', {'id': 2}, token=False)
            self.assertEqual(err.exception.code, 403)
            post('/api/campaign/delete', {'id': 2}).close()
            for status in ('active', 'paused'):
                with self.assertRaises(urllib.error.HTTPError):
                    post('/api/campaign/status', {'id': 2, 'status': status})
            with urllib.request.urlopen(base+'/api/state') as res:
                state = json.load(res)
            self.assertEqual([c['id'] for c in state['campaigns']], [1])
            self.assertEqual(state['totals']['campaigns'], 1)
            self.assertFalse(any(s['campaign_id'] == 2 for s in state['steps']))
        finally:
            server.shutdown()
            server.server_close()
            app.PORT = old_port


if __name__ == '__main__':
    unittest.main()
