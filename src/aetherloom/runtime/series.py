"""The first declarative experience package. Neither an engine nor Canon facts."""
from copy import deepcopy

ACADEMY = {
    'id': 'modern-academy', 'version': 2, 'name': '学院与周边街区',
    'modes': ['text', '2.5d'], 'asset_version': 'academy-art-v2',
    'description': '把作品角色带入现代学院。固定场景、自由配置人物与起点，独立保存本次演化。',
    'places': [
        {'id': 'courtyard', 'name': '校园庭院', 'description': '学院建筑围合的庭院，步道、绿化、长椅与公告栏。', 'neighbors': ['classroom', 'library', 'street']},
        {'id': 'classroom', 'name': '通用教室', 'description': '设有讲台、桌椅和黑板的教室；这里没有自动课程或成绩系统。', 'neighbors': ['courtyard']},
        {'id': 'library', 'name': '图书馆阅览区', 'description': '有书架、阅读桌和服务台的阅览空间。', 'neighbors': ['courtyard']},
        {'id': 'street', 'name': '校外街区', 'description': '学院旁的一段街道与店铺门面，店铺室内暂不开放。', 'neighbors': ['courtyard']},
    ],
    'roles': [
        {'id': 'role-1', 'name': '林澈', 'persona': '喜欢探索与交流的学员。', 'goal': '了解学院，找人交流', 'avatar': 0, 'location': 'courtyard', 'enabled': True},
        {'id': 'role-2', 'name': '苏遥', 'persona': '喜欢阅读，愿意与同伴交换想法的学员。', 'goal': '寻找有趣的资料', 'avatar': 1, 'location': 'courtyard', 'enabled': True},
        {'id': 'role-3', 'name': '沈老师', 'persona': '愿意听取不同意见的教师。', 'goal': '与来访者交流', 'avatar': 2, 'location': 'courtyard', 'enabled': True},
        {'id': 'role-4', 'name': '夏岚', 'persona': '认真细致的馆员。', 'goal': '了解来访者的需要', 'avatar': 3, 'location': 'library', 'enabled': False},
        {'id': 'role-5', 'name': '周宁', 'persona': '熟悉学院日常的工作人员。', 'goal': '留意周围发生的事', 'avatar': 4, 'location': 'classroom', 'enabled': False},
        {'id': 'role-6', 'name': '访客', 'persona': '第一次来到这里的访客。', 'goal': '认识这里的人', 'avatar': 5, 'location': 'street', 'enabled': False},
    ],
    'items': [
        {'id': 'book', 'name': '书', 'description': '可持有、交接的书；可读片段以本次配置为准。', 'holder': 'library'},
        {'id': 'note', 'name': '便笺', 'description': '一张普通便笺。', 'holder': 'courtyard'},
        {'id': 'pass', 'name': '通行卡', 'description': '可以用于本次配置的门禁条件。', 'holder': 'courtyard'},
    ],
}


def catalog():
    return [deepcopy(ACADEMY)]
