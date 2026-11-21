import base64
import io
import unittest
import zipfile
from unittest.mock import Mock, patch
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

import app
import offer_documents
import shared_project
import test_app


class OfferDocumentsTests(unittest.TestCase):
    setUp = test_app.SystemTests.setUp
    tearDown = test_app.SystemTests.tearDown

    def test_proof_points_use_verified_document_quotes_and_available_sources(self):
        content = 'We delivered 120 projects.'
        result = offer_documents.upload(app.db,{'project_id':1,'name':'Delivery.txt',
            'content':base64.b64encode(content.encode()).decode()})
        doc_id = result['documents'][0]['id']
        item = {'project_id':1,'website':'sender.example','sources':['documents']}
        root = {'url':'https://sender.example/','summary':'Certified ISO 27001.','links':[]}
        with patch('app.ai_service.ready',return_value=True),patch.object(app.library,'page',return_value=root) as read, \
                patch('app.ai_service.generate_json',return_value={'proof_points':f'document:{doc_id}\t{content}'}) as model:
            proof = app.ai_workflows.proof_points(item)
            read.assert_not_called()
            self.assertEqual(proof['proof_points'],content+' — Delivery.txt')
            self.assertEqual(proof['sources'],[{'document':'Delivery.txt','quote':content}])
            both = {**item,'sources':['website','documents']}
            app.ai_workflows.proof_points(both)
            self.assertEqual(set(model.call_args.args[1]['pages']),{root['url'],f'document:{doc_id}'})
            read.side_effect = ValueError('Unavailable')
            self.assertTrue(app.ai_workflows.proof_points(both)['website_unavailable'])
            model.return_value = {'proof_points':f'document:{doc_id}\tWe delivered 999 projects.'}
            with self.assertRaisesRegex(ValueError,'Nie potwierdzono cytatu'):
                app.ai_workflows.proof_points(item)

    def test_sources_are_independent_and_combined_in_one_analysis(self):
        item = {'project_id':1,'name':'Oferta.txt','content':base64.b64encode(b'Industrial automation').decode()}
        first = offer_documents.upload(app.db,item)
        self.assertEqual(offer_documents.upload(app.db,item),first)
        site = Mock()
        site.read.return_value = {'source':'https://example.com/','text':'Machine controls','description':'Machine controls'}
        payload = {'project_id':1,'website':'https://example.com/','language':'en'}
        with patch('offer_documents.ai_service.ready',return_value=True), \
                patch('offer_documents.ai_service.generate_json',return_value={'offer':'Reviewed draft'}) as model:
            for sources in (['documents'],['website'],['website','documents']):
                model.reset_mock()
                site.reset_mock()
                result = offer_documents.generate(app.db,site,{**payload,'sources':sources})
                model.assert_called_once()
                inputs = model.call_args.args[1]
                self.assertEqual(bool(inputs['documents']),'documents' in sources)
                self.assertEqual('website' in inputs,'website' in sources)
                self.assertEqual(site.read.called,'website' in sources)
                self.assertEqual(result['offer'],'Reviewed draft')
        self.assertEqual(shared_project.get(app.db,1)['offer'],'')
        self.assertEqual(shared_project.save(app.db,{'project_id':1,'offer_sources':['documents','website']})['offer_sources'],
                         ['website','documents'])

    def test_document_scope_and_local_extraction(self):
        docx = io.BytesIO()
        xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>One</w:t></w:r></w:p><w:p><w:r><w:t>Two</w:t></w:r></w:p></w:body></w:document>'
        with zipfile.ZipFile(docx,'w') as archive:
            archive.writestr('word/document.xml',xml)
        item = {'project_id':1,'name':'Oferta.docx','content':base64.b64encode(docx.getvalue()).decode()}
        result = offer_documents.upload(app.db,item)
        self.assertEqual(result['documents'][0]['characters'],7)
        other = shared_project.create(app.db,{'name':'Other project'})
        self.assertEqual(offer_documents.documents(app.db,other['id']),[])
        with self.assertRaisesRegex(ValueError,'Projekt się zmienił'):
            offer_documents.remove(app.db,{'project_id':1,'id':result['documents'][0]['id']})
        shared_project.select(app.db,{'project_id':1})
        self.assertEqual(offer_documents.remove(app.db,{'project_id':1,'id':result['documents'][0]['id']}),{'documents':[]})

    def test_pdf_text_layer(self):
        writer = PdfWriter()
        page = writer.add_blank_page(250,150)
        name = NameObject
        font = DictionaryObject({name('/Type'):name('/Font'),name('/Subtype'):name('/Type1'),name('/BaseFont'):name('/Helvetica')})
        page[name('/Resources')] = DictionaryObject({name('/Font'):DictionaryObject({name('/F1'):font})})
        stream = DecodedStreamObject()
        stream.set_data(b'BT /F1 12 Tf 20 20 Td (Machine automation) Tj ET')
        page[name('/Contents')] = writer._add_object(stream)
        output = io.BytesIO()
        writer.write(output)
        self.assertEqual(offer_documents._extract('Tests.pdf',output.getvalue()),'Machine automation')
