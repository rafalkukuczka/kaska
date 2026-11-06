import json
import unittest
from unittest.mock import patch,Mock
import launch


class LaunchTests(unittest.TestCase):
    def test_existing_instance_opens_without_starting_another_server(self):
        with patch('launch.configured_port',return_value=8787),patch('launch.ready',return_value=True),patch('launch.webbrowser.open') as browser,patch('launch.subprocess.Popen') as process:
            self.assertEqual(launch.main(),0)
            process.assert_not_called();browser.assert_called_once_with('http://localhost:8787')

    def test_browser_opens_after_server_is_ready_on_custom_port(self):
        child=Mock();child.poll.side_effect=[None,0];child.wait.return_value=0
        with patch('launch.configured_port',return_value=9876),patch('launch.ready',side_effect=[False,True]),patch('launch.webbrowser.open') as browser,patch('launch.subprocess.Popen',return_value=child):
            self.assertEqual(launch.main(),0)
            browser.assert_called_once_with('http://localhost:9876')
            child.terminate.assert_not_called()

    def test_other_application_is_not_treated_as_kaska(self):
        response=Mock();response.read.return_value=json.dumps({'other':'application'}).encode()
        manager=Mock();manager.__enter__=Mock(return_value=response);manager.__exit__=Mock(return_value=False)
        with patch('launch.urllib.request.urlopen',return_value=manager):
            with self.assertRaises(RuntimeError):launch.ready('http://localhost:8787')
