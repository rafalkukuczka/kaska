"""Validated geographic preferences, kept separately from the audience text."""
import math


def validate(value):
    if not isinstance(value,list) or len(value)>10:raise ValueError('Możesz dodać maksymalnie 10 obszarów.')
    result=[]
    for area in value:
        if not isinstance(area,dict):raise ValueError('Nieprawidłowy obszar wyszukiwania.')
        numbers={}
        for key,low,high in [('lat',-90,90),('lng',-180,180),('radius_km',1,1000)]:
            number=area.get(key)
            if type(number) not in (int,float) or not math.isfinite(number) or not low<=number<=high:
                raise ValueError('Podaj poprawne współrzędne i promień od 1 do 1000 km.')
            numbers[key]=round(number,6)
        label=area.get('label','')
        if not isinstance(label,str) or len(label)>100:raise ValueError('Nazwa obszaru może mieć do 100 znaków.')
        row={**numbers,'label':label.strip()}
        if row not in result:result.append(row)
    return result


def query(areas):
    if not areas:return ''
    regions=['{}center latitude {}, longitude {}, radius {} km'.format((a['label']+': ') if a['label'] else '',a['lat'],a['lng'],a['radius_km']) for a in areas]
    return '\nCompany location must be within at least one of these geographic areas (union, not intersection): '+'; '.join(regions)+'.'
