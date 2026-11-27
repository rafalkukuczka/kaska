"""Validated branching phone sequences and routing between call steps."""
import json
import re
from datetime import datetime
from zoneinfo import ZoneInfo

import sequence_conditions


EDGES = {'script': ('answered', 'no_answer'), 'condition': ('yes', 'no')}
CALL_TIME = 'call_time'


def validate_rules(raw, *, draft):
    if not isinstance(raw, list) or len(raw) > 10:
        raise ValueError('Dodaj maksymalnie 10 warunków sekwencji.')
    rules = []
    for rule in raw:
        if isinstance(rule, dict) and rule.get('field') == CALL_TIME:
            start, end = rule.get('start'), rule.get('end')
            if not all(isinstance(hour, str) and (re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]', hour)
                       or (draft and hour == '')) for hour in (start, end)) or (not draft and start == end):
                raise ValueError('Ustaw dwie różne godziny w warunku godziny rozmowy.')
            rules.append({'field': CALL_TIME, 'start': start, 'end': end})
        else:
            rules.extend(sequence_conditions.validate([rule]))
    return rules


def matches(rules, contact, timestamp):
    clock = None
    for rule in rules:
        if rule['field'] != CALL_TIME:
            if not sequence_conditions.matches([rule], contact):
                return False
            continue
        start, end = rule['start'], rule['end']
        if not start or not end or start == end:
            continue
        if clock is None:
            clock = datetime.fromtimestamp(timestamp, ZoneInfo('Europe/Warsaw')).strftime('%H:%M')
        in_range = start <= clock < end if start < end else clock >= start or clock < end
        if not in_range:
            return False
    return True


def init_schema(connection):
    connection.execute("""CREATE TABLE IF NOT EXISTS phone_campaign_flows(
        id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaigns(id), definition TEXT NOT NULL)""")
    connection.execute('CREATE INDEX IF NOT EXISTS phone_flows_campaign ON phone_campaign_flows(campaign_id,id)')
    if 'flow_id' not in {row[1] for row in connection.execute('PRAGMA table_info(phone_campaign_calls)')}:
        connection.execute('ALTER TABLE phone_campaign_calls ADD COLUMN flow_id INTEGER REFERENCES phone_campaign_flows(id)')


def validate(value, validate_variants, *, draft=False):
    if not isinstance(value,dict) or not isinstance(value.get('nodes'),list) or not 1<=len(value['nodes'])<=100:
        raise ValueError('Sekwencja musi zawierać od 1 do 100 elementów.')
    nodes={}
    for raw in value['nodes']:
        if not isinstance(raw,dict):
            raise ValueError('Nieprawidłowy element sekwencji telefonicznej.')
        node_id,kind=raw.get('id'),raw.get('kind')
        if (not isinstance(node_id,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,50}',node_id) or node_id in nodes
                or not isinstance(kind,str) or kind not in EDGES):
            raise ValueError('Nieprawidłowy element sekwencji telefonicznej.')
        node={'id':node_id,'kind':kind}
        if kind=='script':
            body=raw.get('text')
            if not isinstance(body,str) or len(body.strip())>15000 or (not draft and not body.strip()):
                raise ValueError('Uzupełnij tekst każdego skryptu rozmowy.')
            node.update(text=body.strip(),time_variant=None if draft else validate_variants([raw.get('time_variant')],1)[0])
        else:
            rules=validate_rules(raw.get('rules',[]),draft=draft)
            if not draft and not rules:
                raise ValueError('Uzupełnij każdy warunek sekwencji.')
            if any('before_step' in rule for rule in rules):
                raise ValueError('Przypisz warunek bezpośrednio do elementu sekwencji.')
            node['rules']=rules
        for edge in EDGES[kind]:
            target=raw.get(edge)
            if target is not None and not isinstance(target,str):
                raise ValueError('Nieprawidłowe połączenie w sekwencji.')
            node[edge]=target
        nodes[node_id]=node
    entry=value.get('entry')
    if not isinstance(entry,str) or entry not in nodes:
        raise ValueError('Wybierz początek sekwencji.')
    if any(node[edge] is not None and node[edge] not in nodes
           for node in nodes.values() for edge in EDGES[node['kind']]):
        raise ValueError('Połączenie wskazuje usunięty element.')
    if not draft:
        visited,active=set(),set()

        def visit(node_id):
            if node_id in active:
                raise ValueError('Sekwencja zawiera pętlę. Zmień połączenia między krokami.')
            if node_id is None or node_id in visited:
                return
            active.add(node_id)
            node=nodes[node_id]
            for edge in EDGES[node['kind']]:
                visit(node[edge])
            active.remove(node_id)
            visited.add(node_id)

        visit(entry)
        if len(visited)!=len(nodes):
            raise ValueError('Połącz wszystkie elementy z początkiem sekwencji albo usuń nieużywane.')
        if not any(node['kind']=='script' for node in nodes.values()):
            raise ValueError('Dodaj co najmniej jeden skrypt rozmowy.')
    layout=value.get('layout',{})
    if not isinstance(layout,dict) or any(node_id not in nodes or not isinstance(point,list) or len(point)!=2
            or any(type(coordinate) is not int or not 0<=coordinate<=10000 for coordinate in point)
            for node_id,point in layout.items()):
        raise ValueError('Nieprawidłowe położenie elementu sekwencji.')
    return {'entry':entry,'nodes':list(nodes.values()),**({'layout':layout} if layout else {})}


def legacy(scripts, variants, conditions):
    nodes=[]
    entry_rules=[rule for rule in conditions if 'before_step' not in rule or rule['before_step']==0]
    entries=[]
    for position,body in enumerate(scripts):
        rules=entry_rules if position==0 else entry_rules+[rule for rule in conditions if rule.get('before_step')==position]
        script_id=f'script-{position}'
        entries.append(f'condition-{position}' if rules else script_id)
        if rules:
            nodes.append({'id':entries[-1],'kind':'condition','rules':[
                {key:value for key,value in rule.items() if key!='before_step'} for rule in rules],
                'yes':script_id,'no':None})
        nodes.append({'id':script_id,'kind':'script','text':body,'time_variant':variants[position],
                      'answered':None,'no_answer':None})
    for position,node in enumerate(node for node in nodes if node['kind']=='script'):
        if position+1<len(entries):
            node['no_answer']=entries[position+1]
    return {'entry':entries[0] if entries else None,'nodes':nodes}


def versions(connection,campaign_id):
    return {row['id']:json.loads(row['definition']) for row in connection.execute(
        'SELECT id,definition FROM phone_campaign_flows WHERE campaign_id=? ORDER BY id',(campaign_id,))}


def store(connection,campaign_id,flow):
    return connection.execute('INSERT INTO phone_campaign_flows(campaign_id,definition) VALUES(?,?)',
                              (campaign_id,json.dumps(flow,ensure_ascii=False))).lastrowid


def route(flow, contact, previous=None, *, timestamp):
    nodes={node['id']:node for node in flow['nodes']}
    scripts=[node for node in nodes.values() if node['kind']=='script']
    positions={node['id']:index for index,node in enumerate(scripts)}
    target=flow['entry'] if previous is None else scripts[previous['position']][previous['outcome']]
    visited=set()
    while target is not None and target not in visited:
        visited.add(target)
        node=nodes[target]
        if node['kind']=='script':
            return {'position':positions[target],'steps':len(scripts),'script':node['text'],
                    'time_variant':node['time_variant']}
        target=node['yes'] if matches(node['rules'],contact,timestamp) else node['no']
    return None
